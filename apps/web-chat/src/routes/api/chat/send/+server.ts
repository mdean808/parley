import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getSession } from "$lib/server/sessions";
import type { ChatStreamEvent } from "$lib/server/sessions";

export const POST: RequestHandler = async ({ request }) => {
	const { sessionId, message } = await request.json();
	const preview = message.length > 80 ? `${message.slice(0, 80)}...` : message;
	console.log(`[chat] send: session=${sessionId} message="${preview}"`);
	const session = getSession(sessionId);
	if (!session) {
		console.log(`[chat] session not found: ${sessionId}`);
		return error(404, "Session not found");
	}

	// Fire-and-forget: emit results via session event bus when done
	const start = performance.now();
	session.protocol
		.sendRequest(session.userId, message, session.chainId)
		.then((response) => {
			const durationMs = Math.round(performance.now() - start);
			console.log(
				`[chat] response complete: agents=[${response.results.map((r) => r.agentName).join(", ")}] duration=${durationMs}ms`,
			);
			const event: ChatStreamEvent = { type: "results", data: response };
			for (const listener of session.listeners) {
				try {
					listener(event);
				} catch {
					// ignore
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
