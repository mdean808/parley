import type { AgentResult, Protocol } from "core/types";

/**
 * Accumulates AgentResults from the protocol's onMessage callback.
 * Create one per protocol instance and pass collector.handler as the onMessage option.
 */
export class ResultCollector {
	private activeBatch: { results: AgentResult[] } | null = null;

	readonly handler = (result: AgentResult, _chainId: string) => {
		this.activeBatch?.results.push(result);
	};

	startBatch(): { results: AgentResult[] } {
		const batch = { results: [] as AgentResult[] };
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
): Promise<AgentResult[]> {
	const batch = collector.startBatch();
	const { settled } = await protocol.sendRequest(userId, message, chainId);
	await settled;
	return batch.results;
}
