import { decode, encode } from "@toon-format/toon";
import type { MessageV2, OutboundMessageV2 } from "./types.ts";

export function encodeMessageV2(message: MessageV2): string {
	return encode({
		...message,
		replyTo: message.replyTo ?? null,
	});
}

export function decodeMessageV2(toon: string): MessageV2 {
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
	} as MessageV2;
}

export function encodeOutboundV2(fields: OutboundMessageV2): string {
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
