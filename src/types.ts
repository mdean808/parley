/** A registered user that can send requests to agents. */
export interface User {
	id: string;
	name: string;
}

/** A registered agent with a set of skills it can handle. */
export interface Agent {
	id: string;
	name: string;
	skills: string[];
}

/** Protocol message types following the REQUEST → ACK → PROCESS → RESPONSE state machine. */
export type MessageType = "REQUEST" | "ACK" | "PROCESS" | "RESPONSE";

/** A protocol message exchanged between users and agents via the store. */
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

/** Filter criteria for querying stored messages. All fields are optional and ANDed together. */
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

/** Configuration for an agent persona including its name, skills, and LLM system prompt. */
export interface AgentPersona {
	name: string;
	skills: string[];
	systemPrompt: string;
}

/** Callback invoked when a subscriber receives a message from the store. */
export type MessageHandler = (toonMessage: string, message: Message) => void;

/** LLM usage and timing metadata stored as a side-channel alongside TOON messages. */
export interface MessageMeta {
	usage: { inputTokens: number; outputTokens: number };
	model: string;
	durationMs: number;
}

/** Collected result from an agent's response, used for display rendering. */
export interface AgentResult {
	agentName: string;
	skills: string[];
	response: Message;
	usage: { inputTokens: number; outputTokens: number };
	model: string;
	durationMs: number;
}
