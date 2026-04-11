import type Anthropic from "@anthropic-ai/sdk";

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
