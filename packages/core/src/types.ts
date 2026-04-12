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

/**
 * Shared message types common to all protocols.
 * v2 extends these with CLAIM and CANCEL in its own MessageTypeV2.
 */
export type MessageType = "REQUEST" | "ACK" | "PROCESS" | "RESPONSE" | "ERROR";

/**
 * Protocol-agnostic message format used as the common output in AgentResult.
 * Protocol implementations (e.g. v2's MessageV2) map their wire formats to this shape.
 */
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

/** Handler for individual agent results as they arrive via the event system. */
export type ProtocolMessageHandler = (
	result: AgentResult,
	chainId: string,
) => void;

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

/** Returned by Protocol.sendRequest() — the request was sent/queued. */
export interface SendResult {
	chainId: string;
	requestId: string;
	requestToon?: string;
	/**
	 * Resolves when chain activity settles (no new messages for CHAIN_SETTLE_MS).
	 * For synchronous protocols (simple, a2a, crewai, claude-code), resolves
	 * immediately after all onMessage callbacks have fired.
	 */
	settled: Promise<void>;
}

/** Abstraction over the agent-to-agent protocol so the chat app can swap implementations. */
export interface Protocol {
	initialize(userName: string): ProtocolInit | Promise<ProtocolInit>;
	sendRequest(
		userId: string,
		message: string,
		chainId?: string,
	): Promise<SendResult>;
}
