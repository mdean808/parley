import { json } from "@sveltejs/kit";
import {
	getProtocolIds,
	getProtocolRegistration,
} from "simple-implementation/factory";

export function GET() {
	const protocols = getProtocolIds().map((id) => {
		const reg = getProtocolRegistration(id)!;
		return { id, label: reg.label, description: reg.description };
	});
	return json({ protocols });
}
