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

/** Application-level brain injected into the protocol. */
export interface AgentBrain {
	shouldHandle(request: BrainRequest): Promise<boolean>;
	generateResponse(request: BrainRequest): Promise<BrainResponse>;
	shouldDelegate?(request: BrainRequest): Promise<DelegationRequest | null>;
	generateDelegatedResponse?(
		request: BrainRequest,
		delegationResults: DelegationResult[],
	): Promise<BrainResponse>;
}

export interface DelegationRequest {
	payload: string;
	targetSkills: string[];
}

export interface DelegationResult {
	agentName: string;
	agentId: string;
	payload: string;
	type: MessageType;
}

export interface BrainRequest {
	agent: Agent;
	payload: string;
	rawMessage: string;
	allSkills: string[];
}

export interface BrainResponse {
	text: string;
	meta: BrainMeta;
}

export interface BrainMeta {
	usage: { inputTokens: number; outputTokens: number };
	model: string;
	durationMs: number;
}

/** Collected result from an agent's response, used for display rendering. */
export interface AgentResult {
	agentName: string;
	skills: string[];
	response: Message;
	usage?: { inputTokens: number; outputTokens: number };
	model?: string;
	durationMs?: number;
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

/** Returned by Protocol.sendRequest() with the collected agent results. */
export interface ProtocolResponse {
	results: AgentResult[];
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
