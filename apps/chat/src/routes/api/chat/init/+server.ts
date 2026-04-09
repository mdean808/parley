import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createSession } from "$lib/server/sessions";

export const POST: RequestHandler = async ({ request }) => {
	const { protocolId, userName } = await request.json();
	const session = await createSession(protocolId, userName);
	return json({
		sessionId: session.id,
		userId: session.userId,
		agents: session.agents,
		protocolId: session.protocolId,
	});
};
