import type { StoreV2 } from "./store.ts";
import type { ToolResult } from "./types.ts";

const validationFailures: Map<string, number> = new Map();

export function executeToolCall(
	name: string,
	input: Record<string, unknown>,
	store: StoreV2,
	agentId: string,
): ToolResult {
	try {
		switch (name) {
			case "store_message": {
				if (typeof input.message !== "string" || !input.message) {
					return {
						success: false,
						error: `store_message requires a "message" parameter containing a TOON-encoded string. Got ${typeof input.message}. The entire message must be a single TOON string, not separate fields. Example: store_message({ message: "id: \\nversion: 2\\nchainId: ...\\ntype: ACK\\npayload: ...\\nfrom: ...\\nto[1]: *" })`,
					};
				}
				const failCount = validationFailures.get(agentId) ?? 0;
				if (failCount >= 3) {
					return {
						success: false,
						error: `store_message blocked after 3 consecutive validation failures. Your TOON message is malformed. Common issues: missing required fields (version, chainId, type, from, to), unescaped special characters in payload (wrap in quotes), or invalid replyTo referencing a non-existent message id. Reset by sending a correctly formatted TOON message.`,
					};
				}
				try {
					const msg = store.storeMessage(input.message);
					validationFailures.delete(agentId);
					return {
						success: true,
						data: { id: msg.id, type: msg.type, chainId: msg.chainId },
					};
				} catch (error: unknown) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					validationFailures.set(agentId, failCount + 1);
					return {
						success: false,
						error: `TOON validation failed (attempt ${failCount + 1}/3): ${errorMessage}`,
					};
				}
			}
			case "get_agent": {
				const agents = store.getAgent(input.ids as string[]);
				return { success: true, data: agents };
			}
			case "query_agents": {
				const agents = store.queryAgents(input.skills as string[]);
				return { success: true, data: agents };
			}
			case "get_message": {
				const filter: Record<string, unknown> = {};
				for (const key of ["id", "chainId", "from", "to", "type", "replyTo"]) {
					if (input[key] !== undefined) filter[key] = input[key];
				}
				const messages = store.getMessage(filter as never);
				return { success: true, data: messages };
			}
			case "get_chain": {
				const chain = store.getChain(input.chainId as string);
				return chain
					? { success: true, data: chain }
					: { success: false, error: `Chain ${input.chainId} not found` };
			}
			case "get_user": {
				const users = store.getUser(input.ids as string[]);
				return { success: true, data: users };
			}
			case "get_channel": {
				const channel = store.getChannel(input.id_or_name as string);
				return channel
					? { success: true, data: channel }
					: { success: false, error: `Channel ${input.id_or_name} not found` };
			}
			case "list_channels": {
				const channels = store.listChannels(
					input.memberId ? { memberId: input.memberId as string } : undefined,
				);
				return { success: true, data: channels };
			}
			default:
				return { success: false, error: `Unknown tool: ${name}` };
		}
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { success: false, error: errorMessage };
	}
}
