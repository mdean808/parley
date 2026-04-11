import type Anthropic from "@anthropic-ai/sdk";
import type { StoreV2 } from "./store.ts";
import type { ToolResult } from "./types.ts";

const validationFailures: Map<string, number> = new Map();

const PROTOCOL_TOOLS: Anthropic.Messages.Tool[] = [
	{
		name: "store_message",
		description:
			"Send a message via the central store. The message must be a valid TOON-encoded string. The store validates, assigns id/timestamp/sequence, and delivers it.",
		input_schema: {
			type: "object" as const,
			properties: {
				message: {
					type: "string",
					description: "The TOON-encoded message string",
				},
			},
			required: ["message"],
		},
	},
	{
		name: "get_agent",
		description: "Look up agent information by ID(s).",
		input_schema: {
			type: "object" as const,
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Array of agent IDs to look up",
				},
			},
			required: ["ids"],
		},
	},
	{
		name: "query_agents",
		description: "Find agents by skill keywords. Uses substring matching.",
		input_schema: {
			type: "object" as const,
			properties: {
				skills: {
					type: "array",
					items: { type: "string" },
					description: "Skill keywords to search for",
				},
			},
			required: ["skills"],
		},
	},
	{
		name: "get_message",
		description:
			"Retrieve messages from the store using filters. All filters are ANDed together.",
		input_schema: {
			type: "object" as const,
			properties: {
				id: { type: "string", description: "Message ID" },
				chainId: { type: "string", description: "Chain ID" },
				from: { type: "string", description: "Sender ID" },
				to: { type: "string", description: "Recipient ID" },
				type: {
					type: "string",
					description:
						"Message type (REQUEST, ACK, PROCESS, RESPONSE, ERROR, CLAIM, CANCEL)",
				},
				replyTo: { type: "string", description: "Reply-to message ID" },
			},
		},
	},
	{
		name: "get_chain",
		description: "Get chain status, owner, and metadata.",
		input_schema: {
			type: "object" as const,
			properties: {
				chainId: {
					type: "string",
					description: "The chain ID to look up",
				},
			},
			required: ["chainId"],
		},
	},
	{
		name: "get_user",
		description: "Look up user information by ID(s).",
		input_schema: {
			type: "object" as const,
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Array of user IDs to look up",
				},
			},
			required: ["ids"],
		},
	},
	{
		name: "get_channel",
		description: "Look up channel information by ID or name.",
		input_schema: {
			type: "object" as const,
			properties: {
				id_or_name: {
					type: "string",
					description: "Channel ID or name",
				},
			},
			required: ["id_or_name"],
		},
	},
	{
		name: "list_channels",
		description: "List all channels, optionally filtered by member.",
		input_schema: {
			type: "object" as const,
			properties: {
				memberId: {
					type: "string",
					description: "Optional: filter by member ID",
				},
			},
		},
	},
];

export function createToolDefinitions(
	customTools?: Anthropic.Messages.Tool[],
): Anthropic.Messages.Tool[] {
	if (customTools?.length) {
		return [...PROTOCOL_TOOLS, ...customTools];
	}
	return PROTOCOL_TOOLS;
}

export function executeToolCall(
	name: string,
	input: Record<string, unknown>,
	store: StoreV2,
	agentId: string,
): ToolResult {
	try {
		switch (name) {
			case "store_message": {
				const failCount = validationFailures.get(agentId) ?? 0;
				if (failCount >= 3) {
					return {
						success: false,
						error: "Agent failed to validate message after 3 attempts.",
					};
				}
				try {
					const msg = store.storeMessage(input.message as string);
					validationFailures.delete(agentId);
					return {
						success: true,
						data: { id: msg.id, type: msg.type, chainId: msg.chainId },
					};
				} catch (error: unknown) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					validationFailures.set(agentId, failCount + 1);
					return { success: false, error: errorMessage };
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
