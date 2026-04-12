export interface ChatMessage {
	id: string;
	role: "user" | "agent" | "trace";
	messageType?: string;
	content: string;
	toonMessage?: string;
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

/** SSE event types streamed from /api/chat/events */
export interface ChatStreamMessage {
	id: string;
	type: string;
	payload: string;
	chainId: string;
	timestamp: string;
	toon?: string;
}

export interface ChatStreamMeta {
	skills?: string[];
	usage?: { inputTokens: number; outputTokens: number };
	model?: string;
	durationMs?: number;
}

export type ChatStreamEvent =
	| {
			type: "protocol_event";
			agentName: string;
			eventType: string;
			detail: string;
			message?: ChatStreamMessage;
			meta?: ChatStreamMeta;
	  }
	| {
			type: "agent_result";
			result: {
				agentName: string;
				skills: string[];
				response: {
					id: string;
					payload: string;
					timestamp: string;
					type: string;
				};
				usage?: { inputTokens: number; outputTokens: number };
				model?: string;
				durationMs?: number;
				cost?: number;
			};
			chainId: string;
	  }
	| {
			type: "request_toon";
			requestToon: string;
	  }
	| {
			type: "error";
			message: string;
	  };
