import { decode, encode } from "@toon-format/toon";
import type { MessageParley, OutboundMessageParley } from "./types.ts";

export function encodeMessageParley(message: MessageParley): string {
	return encode({
		...message,
		replyTo: message.replyTo ?? null,
	});
}

export function decodeMessageParley(toon: string): MessageParley {
	const raw = decode(toon) as Record<string, unknown>;
	const to = Array.isArray(raw.to) ? raw.to : [raw.to];
	const headers =
		raw.headers && typeof raw.headers === "object"
			? (raw.headers as Record<string, string>)
			: {};
	return {
		...raw,
		to,
		headers,
		version: (raw.version as number) ?? 2,
		sequence: (raw.sequence as number) ?? 0,
		replyTo: raw.replyTo === null ? undefined : (raw.replyTo as string),
	} as MessageParley;
}

export function encodeOutboundParley(fields: OutboundMessageParley): string {
	return encode({
		...fields,
		id: "",
		version: 2,
		sequence: 0,
		timestamp: "",
		headers: fields.headers ?? {},
		replyTo: fields.replyTo ?? null,
	});
}
