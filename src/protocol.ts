import {
	agentHeader,
	agentStats,
	createSpinner,
	renderMarkdown,
	summaryBlock,
} from "./display.ts";
import { log } from "./logger.ts";
import { store } from "./store.ts";
import { encodeOutbound } from "./toon.ts";
import type { AgentResult, Message } from "./types.ts";

const ACK_WINDOW_MS = 5_000;
const HARD_TIMEOUT_MS = 30_000;

export async function sendUserRequest(
	userId: string,
	message: string,
): Promise<void> {
	const chainId = crypto.randomUUID();

	const ackedAgentIds = new Set<string>();
	const responses: Map<string, Message> = new Map();

	let resolveCollector: () => void;
	const collectorDone = new Promise<void>((resolve) => {
		resolveCollector = resolve;
	});

	function checkComplete(): void {
		if (ackedAgentIds.size > 0 && ackedAgentIds.size === responses.size) {
			resolveCollector();
		}
	}

	store.subscribe(userId, (_toonMessage, msg) => {
		if (msg.chainId !== chainId) return;

		if (msg.type === "ACK") {
			ackedAgentIds.add(msg.from);
		} else if (msg.type === "RESPONSE") {
			responses.set(msg.from, msg);
			checkComplete();
		}
	});

	const request = store.sendMessage(
		encodeOutbound({
			chainId,
			replyTo: undefined,
			type: "REQUEST",
			payload: message,
			from: userId,
			to: ["*"],
		}),
	);

	log.info("protocol", "request_sent", {
		chainId,
		userId,
		payload: message,
		requestId: request.id,
	});

	const broadcastStart = performance.now();
	const spinner = createSpinner("Waiting for agents...");

	// Wait for ACK window, then hard timeout, or early resolve
	const ackWindowTimeout = setTimeout(() => {
		// After ACK window, if no agents ACKed, resolve immediately
		if (ackedAgentIds.size === 0) {
			resolveCollector();
		}
	}, ACK_WINDOW_MS);

	const hardTimeout = setTimeout(() => {
		resolveCollector();
	}, HARD_TIMEOUT_MS);

	await collectorDone;

	clearTimeout(ackWindowTimeout);
	clearTimeout(hardTimeout);
	spinner.stop();
	store.unsubscribe(userId);

	const totalDurationMs = performance.now() - broadcastStart;

	if (responses.size === 0) {
		log.warn("protocol", "no_agents_matched", {
			chainId,
			payload: message,
		});
		console.log("\nNo agents had relevant skills for this request.\n");
		return;
	}

	// Build AgentResult array for display
	const results: AgentResult[] = [];
	for (const [agentId, response] of responses) {
		const [agent] = store.getAgent([agentId]);
		if (!agent) continue;

		const meta = store.getMessageMeta(response.id);
		results.push({
			agentName: agent.name,
			skills: agent.skills,
			response,
			usage: meta?.usage ?? { inputTokens: 0, outputTokens: 0 },
			model: meta?.model ?? "",
			durationMs: meta?.durationMs ?? 0,
		});
	}

	const respondedAgents = results.map((r) => r.agentName);
	log.info("protocol", "request_complete", {
		chainId,
		respondedAgents,
		totalDurationMs,
	});

	for (const result of results) {
		console.log(agentHeader(result.agentName, result.skills));
		console.log(renderMarkdown(result.response.payload));
		console.log(agentStats(result.usage, result.durationMs, result.model));
	}

	console.log(summaryBlock(results));
}
