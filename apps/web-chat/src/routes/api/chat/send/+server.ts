import { error, json } from "@sveltejs/kit";
import type { ChatStreamEvent } from "$lib/server/sessions";
import { getSession } from "$lib/server/sessions";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
	const { sessionId, message } = await request.json();
	const preview = message.length > 80 ? `${message.slice(0, 80)}...` : message;
	console.log(`[chat] send: session=${sessionId} message="${preview}"`);
	const session = getSession(sessionId);
	if (!session) {
		console.log(`[chat] session not found: ${sessionId}`);
		return error(404, "Session not found");
	}

	// Fire-and-forget: results arrive via onMessage → SSE
	session.protocol
		.sendRequest(session.userId, message, session.chainId)
		.then(({ requestToon }) => {
			// Emit requestToon so the frontend can display it on the user message
			if (requestToon) {
				const event: ChatStreamEvent = {
					type: "request_toon",
					requestToon,
				};
				for (const listener of session.listeners) {
					try {
						listener(event);
					} catch {
						// ignore
					}
				}
			}
		})
		.catch((err) => {
			console.error(`[chat] sendRequest error:`, err);
			const event: ChatStreamEvent = {
				type: "error",
				message: err instanceof Error ? err.message : String(err),
			};
			for (const listener of session.listeners) {
				try {
					listener(event);
				} catch {
					// ignore
				}
			}
		});

	return json({ ok: true });
};
