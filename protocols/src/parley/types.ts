export type MessageTypeParley =
	| "REQUEST"
	| "ACK"
	| "PROCESS"
	| "RESPONSE"
	| "ERROR"
	| "CLAIM"
	| "CANCEL";

export interface MessageParley {
	id: string;
	version: 2;
	chainId: string;
	sequence: number;
	replyTo: string | undefined;
	timestamp: string;
	type: MessageTypeParley;
	payload: string;
	headers: Record<string, string>;
	from: string;
	to: string[];
}

export type AgentStatus = "idle" | "working" | "offline";

export interface UserParley {
	id: string;
	name: string;
	channels: string[];
}

export interface AgentParley {
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

export interface MessageFilterParley {
	id?: string;
	chainId?: string;
	replyTo?: string;
	timestamp?: string;
	from?: string;
	to?: string;
	type?: MessageTypeParley;
	payload?: string;
}

export type MessageHandlerParley = (
	toonMessage: string,
	message: MessageParley,
) => void;

// Store-originated, out-of-band notifications delivered alongside messages.
// Not persisted in the chain transcript.
export type StoreNotification = {
	type: "claim_rejected";
	chainId: string;
	winner: string;
	requestId: string;
};

export type NotificationHandlerParley = (notification: StoreNotification) => void;

export interface OutboundMessageParley {
	chainId: string;
	replyTo: string | undefined;
	type: MessageTypeParley;
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
