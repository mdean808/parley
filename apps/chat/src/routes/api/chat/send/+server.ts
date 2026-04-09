import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getSession } from "$lib/server/sessions";

export const POST: RequestHandler = async ({ request }) => {
	const { sessionId, message } = await request.json();
	const preview = message.length > 80 ? `${message.slice(0, 80)}...` : message;
	console.log(`[chat] send: session=${sessionId} message="${preview}"`);
	const session = getSession(sessionId);
	if (!session) {
		console.log(`[chat] session not found: ${sessionId}`);
		return error(404, "Session not found");
	}
	const start = performance.now();
	const { results } = await session.protocol.sendRequest(
		session.userId,
		message,
		session.chainId,
	);
	const durationMs = Math.round(performance.now() - start);
	console.log(
		`[chat] response complete: agents=[${results.map((r) => r.agentName).join(", ")}] duration=${durationMs}ms`,
	);
	return json({ results });
};
