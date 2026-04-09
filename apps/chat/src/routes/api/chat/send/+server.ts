import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getSession } from "$lib/server/sessions";

export const POST: RequestHandler = async ({ request }) => {
	const { sessionId, message } = await request.json();
	const session = getSession(sessionId);
	if (!session) {
		return error(404, "Session not found");
	}
	const { results } = await session.protocol.sendRequest(
		session.userId,
		message,
		session.chainId,
	);
	return json({ results });
};
