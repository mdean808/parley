import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createSession } from "$lib/server/sessions";

export const POST: RequestHandler = async ({ request }) => {
	const { protocolId, userName } = await request.json();
	console.log(`[chat] init session: protocol=${protocolId} user=${userName}`);
	const session = await createSession(protocolId, userName);
	console.log(
		`[chat] session ready: id=${session.id} agents=[${session.agents.map((a) => a.name).join(", ")}]`,
	);
	return json({
		sessionId: session.id,
		userId: session.userId,
		agents: session.agents,
		protocolId: session.protocolId,
	});
};
