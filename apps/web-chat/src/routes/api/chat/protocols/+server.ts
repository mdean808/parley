import { json } from "@sveltejs/kit";
import {
	getProtocolIds,
	getProtocolRegistration,
} from "protocols/factory";

export function GET() {
	console.log("[chat] GET /api/chat/protocols");
	const protocols = getProtocolIds().map((id) => {
		const reg = getProtocolRegistration(id)!;
		return { id, label: reg.label, description: reg.description };
	});
	console.log("[chat] available protocols:", protocols.map((p) => p.id).join(", "));
	return json({ protocols });
}
