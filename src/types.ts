export interface User {
	id: string;
	name: string;
}

export interface Agent {
	id: string;
	name: string;
	skills: string[];
}

export type MessageType = "REQUEST" | "ACK" | "PROCESS" | "RESPONSE";

export interface Message {
	id: string;
	chainId: string;
	replyTo: string | undefined;
	timestamp: string;
	type: MessageType;
	payload: string;
	from: string;
	to: string[];
}

export interface MessageFilter {
	id?: string;
	chainId?: string;
	replyTo?: string;
	timestamp?: string;
	from?: string;
	to?: string;
	type?: MessageType;
	payload?: string;
}

export interface AgentPersona {
	name: string;
	skills: string[];
	systemPrompt: string;
}

export type MessageHandler = (toonMessage: string, message: Message) => void;

export interface MessageMeta {
	usage: { inputTokens: number; outputTokens: number };
	model: string;
	durationMs: number;
}

export interface AgentResult {
	agentName: string;
	skills: string[];
	response: Message;
	usage: { inputTokens: number; outputTokens: number };
	model: string;
	durationMs: number;
}
