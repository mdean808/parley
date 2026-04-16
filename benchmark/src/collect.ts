import type {
	AgentResult,
	Protocol,
	ProtocolAgentInfo,
	ProtocolEvent,
} from "core/types";
import type { AgentTerminalState, DeclineInfo } from "./types.ts";

interface Batch {
	results: AgentResult[];
	declines: DeclineInfo[];
}

/**
 * Accumulates AgentResults from the protocol's onMessage callback
 * and decline/error events from the protocol's onEvent callback.
 * Create one per protocol instance and pass collector.handler as onMessage
 * and collector.eventHandler as onEvent.
 */
export class ResultCollector {
	private activeBatch: Batch | null = null;
	private responded = new Set<string>();
	private declinedReasons = new Map<string, string>();
	private errored = new Map<string, string>();

	readonly handler = (result: AgentResult, _chainId: string) => {
		this.activeBatch?.results.push(result);
		this.responded.add(result.agentName);
	};

	readonly eventHandler = (event: ProtocolEvent) => {
		if (event.type === "decline") {
			this.activeBatch?.declines.push({
				agentName: event.agentName,
				reason: event.detail,
			});
			this.declinedReasons.set(event.agentName, event.detail);
		} else if (event.type === "error") {
			this.errored.set(event.agentName, event.detail);
		}
	};

	startBatch(): Batch {
		const batch: Batch = { results: [], declines: [] };
		this.activeBatch = batch;
		this.responded = new Set();
		this.declinedReasons = new Map();
		this.errored = new Map();
		return batch;
	}

	getTerminalStates(allAgents: ProtocolAgentInfo[]): AgentTerminalState[] {
		const states: AgentTerminalState[] = [];
		for (const agent of allAgents) {
			if (this.responded.has(agent.name)) {
				states.push({
					agentName: agent.name,
					skills: agent.skills,
					status: "responded",
				});
			} else if (this.declinedReasons.has(agent.name)) {
				states.push({
					agentName: agent.name,
					skills: agent.skills,
					status: "declined",
					reason: this.declinedReasons.get(agent.name),
				});
			} else if (this.errored.has(agent.name)) {
				states.push({
					agentName: agent.name,
					skills: agent.skills,
					status: "errored",
					reason: this.errored.get(agent.name),
				});
			} else {
				states.push({
					agentName: agent.name,
					skills: agent.skills,
					status: "timed-out",
				});
			}
		}
		return states;
	}
}

/**
 * Sends a request and collects results via the settled promise.
 * Used by the benchmark to bridge the fire-and-forget sendRequest
 * with the synchronous collection it needs.
 */
export async function collectSendRequest(
	protocol: Protocol,
	collector: ResultCollector,
	userId: string,
	message: string,
	chainId: string,
): Promise<Batch> {
	const batch = collector.startBatch();
	const { settled } = await protocol.sendRequest(userId, message, chainId);
	await settled;
	return batch;
}
