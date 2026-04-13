import { MODEL } from "core/config";
import { computeCost } from "core/cost";
import type { Protocol } from "core/types";
import { checkAssertions } from "./assertions.ts";
import { collectSendRequest, type ResultCollector } from "./collect.ts";
import { evaluateProbe } from "./judge.ts";
import type { JudgeConfig } from "./judge-types.ts";
import type {
	AgentProbeResult,
	DeclineInfo,
	ProbeConfig,
	ProbeExpect,
	ProbeResult,
	ProtocolId,
} from "./types.ts";

export { ResultCollector } from "./collect.ts";

export async function runProbe(
	protocol: Protocol,
	protocolId: ProtocolId,
	probe: ProbeConfig,
	judgeConfig?: JudgeConfig,
	onPhase?: (phase: string) => void,
	collector?: ResultCollector,
	supportsRouting?: boolean,
): Promise<ProbeResult> {
	const { userId } = await protocol.initialize("BenchUser");
	const chainId = crypto.randomUUID();

	let agents: AgentProbeResult[] = [];
	let declines: DeclineInfo[] = [];
	let error: string | undefined;

	const start = performance.now();
	try {
		if (collector) {
			const batch = await collectSendRequest(
				protocol,
				collector,
				userId,
				probe.prompt,
				chainId,
			);
			declines = batch.declines;
			agents = batch.results.map((r) => {
				const inputTokens = r.usage?.inputTokens ?? 0;
				const outputTokens = r.usage?.outputTokens ?? 0;
				const model = r.model ?? MODEL;
				return {
					agentName: r.agentName,
					skills: r.skills,
					responseText: r.response.payload,
					inputTokens,
					outputTokens,
					cost: r.cost ?? computeCost(inputTokens, outputTokens, model),
					durationMs: r.durationMs ?? 0,
					model,
				};
			});
		} else {
			await protocol.sendRequest(userId, probe.prompt, chainId);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
	const totalDurationMs = performance.now() - start;

	// For non-routing protocols, skip routing-specific assertions
	// (agentCount.max and excludedSkills) since they broadcast to all agents
	const effectiveExpect: ProbeExpect =
		supportsRouting === true
			? probe.expect
			: {
					agentCount:
						probe.expect.agentCount?.min != null
							? { min: probe.expect.agentCount.min }
							: undefined,
					requiredSkills: probe.expect.requiredSkills,
				};

	// Layer 1: Assertions
	const assertions = error
		? {
				passed: false,
				details: [
					{
						name: "execution",
						passed: false,
						expected: "no error",
						actual: error,
					},
				],
			}
		: checkAssertions(effectiveExpect, agents);

	// Layer 2: Judge (only if assertions pass and judge enabled)
	let judge: ProbeResult["judge"];
	if (judgeConfig?.enabled && !error) {
		onPhase?.("judge");
		try {
			const { evaluation } = await evaluateProbe(
				probe.prompt,
				probe.targetSkills,
				agents,
				probe.pattern,
				judgeConfig,
				declines,
			);
			judge = evaluation;
		} catch {
			// Judge failure doesn't fail the probe — just no judge data
			judge = undefined;
		}
	}

	return {
		probeId: probe.id,
		protocolId,
		pattern: probe.pattern,
		prompt: probe.prompt,
		agents,
		declines: declines.length > 0 ? declines : undefined,
		assertions,
		judge,
		totalInputTokens: agents.reduce((s, a) => s + a.inputTokens, 0),
		totalOutputTokens: agents.reduce((s, a) => s + a.outputTokens, 0),
		totalCost: agents.reduce((s, a) => s + a.cost, 0),
		totalDurationMs,
		error,
	};
}
