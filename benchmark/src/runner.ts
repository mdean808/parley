import { MODEL } from "core/config";
import { computeCost } from "core/cost";
import type { Protocol } from "core/types";
import { checkAssertions } from "./assertions.ts";
import { collectSendRequest, type ResultCollector } from "./collect.ts";
import { evaluateProbe } from "./judge.ts";
import type { JudgeConfig } from "./judge-types.ts";
import type {
	AgentProbeResult,
	AgentTerminalState,
	DeclineInfo,
	ProbeConfig,
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
	const init = await protocol.initialize("BenchUser");
	const userId = init.userId;
	const allAgents = init.agents;
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
			enrichParleyDeclinesFromAcks(protocol, chainId, collector);
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

	const terminalStates: AgentTerminalState[] = collector
		? collector.getTerminalStates(allAgents)
		: allAgents.map((a) => ({
				agentName: a.name,
				skills: a.skills,
				status: "timed-out" as const,
			}));

	// Layer 1: Assertions
	const assertions = error
		? {
				passed: false,
				details: [
					{
						name: "execution",
						passed: false,
						status: "fail" as const,
						expected: "no error",
						actual: error,
					},
				],
			}
		: checkAssertions(
				probe.expect,
				agents,
				supportsRouting ?? true,
				terminalStates,
			);

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
				allAgents,
				terminalStates,
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

/**
 * For parley protocol runs, decline reasons now live inside the ACK message
 * payload (header `accept: false`), not in the agent's trailing narration.
 * Pull the reason from the store for any decline that arrived without one.
 * No-op for other protocols (structural check on `store.getMessage`).
 */
function enrichParleyDeclinesFromAcks(
	protocol: Protocol,
	chainId: string,
	collector: ResultCollector,
): void {
	const store = (protocol as unknown as { store?: unknown }).store as
		| {
				getMessage: (
					filter: { chainId: string; type: string },
				) => Array<{
					from: string;
					payload: string;
					headers?: Record<string, string>;
				}>;
				getAgent: (
					ids: string[],
				) => Array<{ id: string; name: string }>;
		  }
		| undefined;
	if (!store?.getMessage || !store.getAgent) return;

	const acks = store.getMessage({ chainId, type: "ACK" });
	for (const ack of acks) {
		const [agent] = store.getAgent([ack.from]);
		if (!agent) continue;
		const accept = ack.headers?.accept;
		const payload = ack.payload?.trim();
		if (accept === "false") {
			collector.setDeclineReason(
				agent.name,
				payload || "(explicit ACK decline; no reason in payload)",
			);
		} else if (accept !== "true" && payload) {
			// Missing accept header but non-empty payload — surface it anyway
			collector.setDeclineReason(agent.name, payload);
		}
	}
}
