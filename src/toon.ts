import { decode, encode } from "@toon-format/toon";
import type { Message } from "./types.ts";

export function encodeMessage(message: Message): string {
	return encode({
		...message,
		replyTo: message.replyTo ?? null,
	});
}

export function decodeMessage(toon: string): Message {
	const raw = decode(toon) as Record<string, unknown>;
	const to = Array.isArray(raw.to) ? raw.to : [raw.to];
	return {
		...raw,
		to,
		replyTo: raw.replyTo === null ? undefined : raw.replyTo,
	} as Message;
}

export function validateToon(message: Message): string {
	return encodeMessage(message);
}
