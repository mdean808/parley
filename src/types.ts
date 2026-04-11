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
export type MessageType = "REQUEST" | "ACK" | "PROCESS" | "RESPONSE" | "ERROR";

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

export interface ProtocolEvent {
	agentName: string;
	type:
		| "skill_eval"
		| "state_change"
		| "decline"
		| "delegation"
		| "tool_use"
		| "error";
	detail: string;
}

export type ProtocolEventHandler = (event: ProtocolEvent) => void;

/** Collected result from an agent's response, used for display rendering. */
export interface AgentResult {
	agentName: string;
	skills: string[];
	response: Message;
	usage?: { inputTokens: number; outputTokens: number };
	model?: string;
	durationMs?: number;
	cost?: number;
}

/** Summary info about an agent exposed to the chat application layer. */
export interface ProtocolAgentInfo {
	name: string;
	skills: string[];
}

/** Returned by Protocol.initialize() with the registered user and agent list. */
export interface ProtocolInit {
	userId: string;
	userName: string;
	agents: ProtocolAgentInfo[];
}

/** A single protocol message captured during request processing. */
export interface TraceMessage {
	agentName: string;
	type: string;
	messageId: string;
	payload: string;
	toon: string;
	timestamp: string;
}

/** Returned by Protocol.sendRequest() with the collected agent results. */
export interface ProtocolResponse {
	results: AgentResult[];
	trace?: TraceMessage[];
	requestToon?: string;
}

/** Abstraction over the agent-to-agent protocol so the chat app can swap implementations. */
export interface Protocol {
	initialize(userName: string): ProtocolInit | Promise<ProtocolInit>;
	sendRequest(
		userId: string,
		message: string,
		chainId?: string,
	): Promise<ProtocolResponse>;
}
