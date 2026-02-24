import type { ProtocolAgent } from "./agent.ts";
import {
	agentHeader,
	agentStats,
	createSpinner,
	renderMarkdown,
	summaryBlock,
} from "./display.ts";
import { log } from "./logger.ts";
import { store } from "./store.ts";

export async function broadcastRequest(
	userId: string,
	message: string,
	agents: ProtocolAgent[],
): Promise<void> {
	const chainId = crypto.randomUUID();

	const request = store.storeMessage({
		chainId,
		replyTo: undefined,
		type: "REQUEST",
		payload: message,
		from: userId,
		to: ["*"],
	});

	log.info("protocol", "broadcast_start", {
		chainId,
		userId,
		payload: message,
		agentCount: agents.length,
	});

	const broadcastStart = performance.now();
	const spinner = createSpinner("Waiting for agents...");
	const allResults = await Promise.all(
		agents.map((agent) => agent.handleRequest(request)),
	);
	spinner.stop();
	const totalDurationMs = performance.now() - broadcastStart;

	const results = allResults.filter((r) => r !== null);

	if (results.length === 0) {
		log.warn("protocol", "no_agents_matched", { chainId, payload: message });
		console.log("\nNo agents had relevant skills for this request.\n");
		return;
	}

	const respondedAgents = results.map((r) => r.agentName);
	const respondedIds = new Set(results.map((r) => r.agentName));
	const declinedAgents = agents
		.map((a) => a.agent.name)
		.filter((name) => !respondedIds.has(name));

	log.info("protocol", "broadcast_complete", {
		chainId,
		respondedAgents,
		declinedAgents,
		totalDurationMs,
	});

	for (const result of results) {
		console.log(agentHeader(result.agentName, result.skills));
		console.log(renderMarkdown(result.response.payload));
		console.log(agentStats(result.usage, result.durationMs, result.model));
	}

	console.log(summaryBlock(results));
}
