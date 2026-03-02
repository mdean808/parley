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

/** Maximum time (ms) to wait for agents to send ACKs before assuming they declined. */
const ACK_WINDOW_MS: number = 5_000;

/** Maximum time (ms) to wait for all responses before resolving with whatever has arrived. */
const HARD_TIMEOUT_MS: number = 30_000;

/**
 * Sends a user's request to all agents via the store's pub/sub system and
 * collects responses. Subscribes the user as a response collector, encodes
 * the REQUEST as TOON, and waits using a two-phase timeout:
 *
 * 1. ACK window (5s): if no agent ACKs within this period, resolves immediately.
 * 2. Hard timeout (30s): resolves with whatever responses have arrived.
 * 3. Early resolve: completes as soon as all ACKed agents have sent RESPONSE.
 *
 * Displays agent responses and a summary block to the terminal.
 *
 * @param userId - The ID of the user sending the request.
 * @param message - The user's request text.
 */
export async function sendUserRequest(
	userId: string,
	message: string,
): Promise<void> {
	const chainId: string = crypto.randomUUID();

	const ackedAgentIds: Set<string> = new Set<string>();
	const responses: Map<string, Message> = new Map();

	let resolveCollector: () => void;
	const collectorDone: Promise<void> = new Promise<void>((resolve) => {
		resolveCollector = resolve;
	});

	/** Resolves the collector promise once all ACKed agents have responded. */
	function checkComplete(): void {
		if (ackedAgentIds.size > 0 && ackedAgentIds.size === responses.size) {
			resolveCollector();
		}
	}

	store.subscribe(userId, (_toonMessage: string, msg: Message) => {
		if (msg.chainId !== chainId) return;

		if (msg.type === "ACK") {
			ackedAgentIds.add(msg.from);
		} else if (msg.type === "RESPONSE") {
			responses.set(msg.from, msg);
			checkComplete();
		}
	});

	const request: Message = store.sendMessage(
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

	const broadcastStart: number = performance.now();
	const spinner = createSpinner("Waiting for agents...");

	// Wait for ACK window, then hard timeout, or early resolve
	const ackWindowTimeout: ReturnType<typeof setTimeout> = setTimeout(() => {
		// After ACK window, if no agents ACKed, resolve immediately
		if (ackedAgentIds.size === 0) {
			resolveCollector();
		}
	}, ACK_WINDOW_MS);

	const hardTimeout: ReturnType<typeof setTimeout> = setTimeout(() => {
		resolveCollector();
	}, HARD_TIMEOUT_MS);

	await collectorDone;

	clearTimeout(ackWindowTimeout);
	clearTimeout(hardTimeout);
	spinner.stop();
	store.unsubscribe(userId);

	const totalDurationMs: number = performance.now() - broadcastStart;

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

	const respondedAgents: string[] = results.map((r) => r.agentName);
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
