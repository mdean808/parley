export interface ChatMessage {
	id: string;
	role: "user" | "agent";
	content: string;
	rawPayload?: string;
	agentName?: string;
	skills?: string[];
	usage?: { inputTokens: number; outputTokens: number };
	model?: string;
	durationMs?: number;
	cost?: number;
	timestamp: string;
}

export interface AgentInfo {
	name: string;
	skills: string[];
}

export interface ProtocolInfo {
	id: string;
	label: string;
	description: string;
}
