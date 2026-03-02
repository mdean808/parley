import { decode, encode } from "@toon-format/toon";
import type { Message } from "./types.ts";

/**
 * Encodes a complete protocol message as a TOON string.
 * Converts `undefined` replyTo to `null` for TOON compatibility.
 * @param message - The complete message with id and timestamp already assigned.
 * @returns The TOON-encoded string.
 */
export function encodeMessage(message: Message): string {
	return encode({
		...message,
		replyTo: message.replyTo ?? null,
	});
}

/**
 * Decodes a TOON string back into a protocol message.
 * Normalizes the `to` field to always be an array and converts `null` replyTo to `undefined`.
 * @param toon - The TOON-encoded string to decode.
 * @returns The decoded Message object.
 */
export function decodeMessage(toon: string): Message {
	const raw = decode(toon) as Record<string, unknown>;
	const to = Array.isArray(raw.to) ? raw.to : [raw.to];
	return {
		...raw,
		to,
		replyTo: raw.replyTo === null ? undefined : raw.replyTo,
	} as Message;
}

/**
 * Encodes a partial outbound message as TOON, using empty-string placeholders for
 * `id` and `timestamp` which will be assigned by the store upon receipt.
 * @param fields - Message fields excluding id and timestamp.
 * @returns The TOON-encoded string ready to send via `store.sendMessage()`.
 */
export function encodeOutbound(
	fields: Omit<Message, "id" | "timestamp">,
): string {
	return encode({
		...fields,
		id: "",
		timestamp: "",
		replyTo: fields.replyTo ?? null,
	});
}

/**
 * Validates that a message can be successfully encoded as TOON.
 * Throws if the message structure is malformed.
 * @param message - The message to validate.
 * @returns The TOON-encoded string.
 */
export function validateToon(message: Message): string {
	return encodeMessage(message);
}
