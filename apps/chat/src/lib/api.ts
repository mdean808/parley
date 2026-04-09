import type { ProtocolInfo, AgentInfo } from "./types";
import type { AgentResult } from "simple-implementation/types";

export async function fetchProtocols(): Promise<ProtocolInfo[]> {
	const res = await fetch("/api/chat/protocols");
	const data = await res.json();
	return data.protocols;
}

export async function initSession(
	protocolId: string,
	userName: string,
): Promise<{
	sessionId: string;
	userId: string;
	agents: AgentInfo[];
	protocolId: string;
}> {
	const res = await fetch("/api/chat/init", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ protocolId, userName }),
	});
	return res.json();
}

export async function sendMessage(
	sessionId: string,
	message: string,
): Promise<AgentResult[]> {
	const res = await fetch("/api/chat/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sessionId, message }),
	});
	const data = await res.json();
	return data.results;
}
