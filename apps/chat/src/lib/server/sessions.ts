import { createProtocol } from "simple-implementation/factory";
import type { Protocol, ProtocolAgentInfo } from "simple-implementation/types";

export interface Session {
	id: string;
	protocol: Protocol;
	protocolId: string;
	userId: string;
	userName: string;
	chainId: string;
	agents: ProtocolAgentInfo[];
}

const sessions = new Map<string, Session>();

export async function createSession(
	protocolId: string,
	userName: string,
): Promise<Session> {
	const protocol = createProtocol(protocolId);
	const { userId, agents } = await protocol.initialize(userName);
	const session: Session = {
		id: crypto.randomUUID(),
		protocol,
		protocolId,
		userId,
		userName,
		chainId: crypto.randomUUID(),
		agents,
	};
	sessions.set(session.id, session);
	return session;
}

export function getSession(id: string): Session | undefined {
	return sessions.get(id);
}
