import { json } from "@sveltejs/kit";
import { createSession } from "$lib/server/sessions";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
	const { protocolId, userName, soloAgentName } = await request.json();
	console.log(
		`[chat] init session: protocol=${protocolId} user=${userName} solo=${soloAgentName ?? "none"}`,
	);
	const session = await createSession(protocolId, userName, soloAgentName);
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
