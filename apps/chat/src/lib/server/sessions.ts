import { createProtocol } from "simple-implementation/factory";
import type { Protocol, ProtocolAgentInfo, ProtocolEvent } from "simple-implementation/types";

export interface ChatStreamMessage {
	id: string;
	type: string;
	payload: string;
	chainId: string;
	timestamp: string;
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
			type: "results";
			data: unknown;
	  }
	| {
			type: "error";
			message: string;
	  };

export type ChatStreamListener = (event: ChatStreamEvent) => void;

export interface Session {
	id: string;
	protocol: Protocol;
	protocolId: string;
	userId: string;
	userName: string;
	chainId: string;
	agents: ProtocolAgentInfo[];
	listeners: Set<ChatStreamListener>;
	/** v2 internal store reference (null for other protocols) */
	_store: unknown;
	/** agent name → agent ID mapping (v2 only) */
	_agentNameToId: Map<string, string>;
	/** agent ID → skills mapping (v2 only) */
	_agentIdToSkills: Map<string, string[]>;
}

const sessions = new Map<string, Session>();

function emitEvent(session: Session, event: ChatStreamEvent): void {
	for (const listener of session.listeners) {
		try {
			listener(event);
		} catch {
			// don't let a broken listener crash the event bus
		}
	}
}

function buildEnrichedEvent(
	session: Session,
	event: ProtocolEvent,
): ChatStreamEvent {
	const base: ChatStreamEvent = {
		type: "protocol_event",
		agentName: event.agentName,
		eventType: event.type,
		detail: event.detail,
	};

	// Enrich state_change events with store data (v2 only)
	if (event.type === "state_change" && session._store) {
		const match = event.detail.match(/^(\w+) sent$/);
		if (match) {
			const msgType = match[1];
			const agentId = session._agentNameToId.get(event.agentName);
			if (agentId) {
				const store = session._store as {
					getMessage(filter: Record<string, unknown>): Array<{
						id: string;
						type: string;
						payload: string;
						chainId: string;
						timestamp: string;
					}>;
				};
				const msgs = store.getMessage({
					type: msgType,
					from: agentId,
					chainId: session.chainId,
				});
				const msg = msgs[msgs.length - 1];
				if (msg) {
					(base as Extract<ChatStreamEvent, { type: "protocol_event" }>).message = {
						id: msg.id,
						type: msg.type,
						payload: msg.payload,
						chainId: msg.chainId,
						timestamp: msg.timestamp,
					};

					// For RESPONSE, attach usage/model/duration from agentMeta
					if (msgType === "RESPONSE") {
						const proto = session.protocol as unknown as {
							agentMeta?: Map<string, { usage: { inputTokens: number; outputTokens: number }; model: string; durationMs: number }>;
						};
						const meta = proto.agentMeta?.get(`${agentId}:${session.chainId}`);
						const skills = session._agentIdToSkills.get(agentId);
						(base as Extract<ChatStreamEvent, { type: "protocol_event" }>).meta = {
							skills,
							usage: meta?.usage,
							model: meta?.model,
							durationMs: meta?.durationMs,
						};
					}
				}
			}
		}
	}

	return base;
}

export async function createSession(
	protocolId: string,
	userName: string,
): Promise<Session> {
	// Session ref needed inside onEvent — populated after construction
	let session: Session;

	const onEvent = (event: ProtocolEvent) => {
		console.log(`[chat] [${event.agentName}] ${event.type}: ${event.detail}`);
		if (session) {
			const enriched = buildEnrichedEvent(session, event);
			emitEvent(session, enriched);
		}
	};

	const protocol = createProtocol(protocolId, { onEvent });
	const { userId, agents } = await protocol.initialize(userName);

	// Extract v2 internals (store, agents) — no-op for other protocols
	const _store = (protocol as Record<string, unknown>).store ?? null;
	const _agentNameToId = new Map<string, string>();
	const _agentIdToSkills = new Map<string, string[]>();

	const protocolAgents = (protocol as Record<string, unknown>).protocolAgents as
		| Array<{ agent: { id: string; name: string; skills: string[] } }>
		| undefined;
	if (protocolAgents) {
		for (const pa of protocolAgents) {
			_agentNameToId.set(pa.agent.name, pa.agent.id);
			_agentIdToSkills.set(pa.agent.id, pa.agent.skills);
		}
	}

	session = {
		id: crypto.randomUUID(),
		protocol,
		protocolId,
		userId,
		userName,
		chainId: crypto.randomUUID(),
		agents,
		listeners: new Set(),
		_store,
		_agentNameToId,
		_agentIdToSkills,
	};
	sessions.set(session.id, session);
	return session;
}

export function getSession(id: string): Session | undefined {
	return sessions.get(id);
}

export function addSessionListener(
	sessionId: string,
	listener: ChatStreamListener,
): void {
	const session = sessions.get(sessionId);
	if (session) session.listeners.add(listener);
}

export function removeSessionListener(
	sessionId: string,
	listener: ChatStreamListener,
): void {
	const session = sessions.get(sessionId);
	if (session) session.listeners.delete(listener);
}
