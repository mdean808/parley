import type { AgentInfo, ChatStreamEvent, ProtocolInfo } from "./types";

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

/** Fire-and-forget: sends a message, does not wait for results. */
export async function sendMessage(
	sessionId: string,
	message: string,
): Promise<void> {
	await fetch("/api/chat/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sessionId, message }),
	});
}

/** Opens a persistent SSE connection. Returns an AbortController to disconnect. */
export function connectToEvents(
	sessionId: string,
	onEvent: (event: ChatStreamEvent) => void,
): AbortController {
	const controller = new AbortController();

	(async () => {
		try {
			const res = await fetch(
				`/api/chat/events?sessionId=${encodeURIComponent(sessionId)}`,
				{ signal: controller.signal },
			);
			if (!res.ok || !res.body) return;

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Parse SSE frames
				const parts = buffer.split("\n\n");
				buffer = parts.pop() ?? "";

				for (const part of parts) {
					for (const line of part.split("\n")) {
						if (line.startsWith("data: ")) {
							try {
								const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
								onEvent(event);
							} catch {
								// malformed JSON, skip
							}
						}
						// skip comments (lines starting with :) and other fields
					}
				}
			}
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				console.error("[chat] SSE connection error:", err);
			}
		}
	})();

	return controller;
}
