export type MessageTypeV2 =
	| "REQUEST"
	| "ACK"
	| "PROCESS"
	| "RESPONSE"
	| "ERROR"
	| "CLAIM"
	| "CANCEL";

export interface MessageV2 {
	id: string;
	version: 2;
	chainId: string;
	sequence: number;
	replyTo: string | undefined;
	timestamp: string;
	type: MessageTypeV2;
	payload: string;
	headers: Record<string, string>;
	from: string;
	to: string[];
}

export type AgentStatus = "idle" | "working" | "offline";

export interface UserV2 {
	id: string;
	name: string;
	channels: string[];
}

export interface AgentV2 {
	id: string;
	name: string;
	skills: string[];
	channels: string[];
	status: AgentStatus;
}

export interface Chain {
	chainId: string;
	owner: string | undefined;
	status: "active" | "cancelled" | "expired";
	createdAt: string;
}

export interface Channel {
	id: string;
	name: string;
	members: string[];
}

export interface MessageFilterV2 {
	id?: string;
	chainId?: string;
	replyTo?: string;
	timestamp?: string;
	from?: string;
	to?: string;
	type?: MessageTypeV2;
	payload?: string;
}

export type MessageHandlerV2 = (
	toonMessage: string,
	message: MessageV2,
) => void;

// Store-originated, out-of-band notifications delivered alongside messages.
// Not persisted in the chain transcript.
export type StoreNotification = {
	type: "claim_rejected";
	chainId: string;
	winner: string;
	requestId: string;
};

export type NotificationHandlerV2 = (notification: StoreNotification) => void;

export interface OutboundMessageV2 {
	chainId: string;
	replyTo: string | undefined;
	type: MessageTypeV2;
	payload: string;
	headers?: Record<string, string>;
	from: string;
	to: string[];
}

export interface ToolResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface AgentMeta {
	usage: { inputTokens: number; outputTokens: number };
	model: string;
	durationMs: number;
}
