import type { AgentResult, Protocol, ProtocolEvent } from "core/types";
import type { DeclineInfo } from "./types.ts";

interface Batch {
	results: AgentResult[];
	declines: DeclineInfo[];
}

/**
 * Accumulates AgentResults from the protocol's onMessage callback
 * and decline events from the protocol's onEvent callback.
 * Create one per protocol instance and pass collector.handler as onMessage
 * and collector.eventHandler as onEvent.
 */
export class ResultCollector {
	private activeBatch: Batch | null = null;

	readonly handler = (result: AgentResult, _chainId: string) => {
		this.activeBatch?.results.push(result);
	};

	readonly eventHandler = (event: ProtocolEvent) => {
		if (event.type === "decline") {
			this.activeBatch?.declines.push({
				agentName: event.agentName,
				reason: event.detail,
			});
		}
	};

	startBatch(): Batch {
		const batch: Batch = { results: [], declines: [] };
		this.activeBatch = batch;
		return batch;
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
