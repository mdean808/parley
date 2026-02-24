import { encode, decode } from "@toon-format/toon";
import type { Message } from "./types.ts";

export function encodeMessage(message: Message): string {
  return encode({
    ...message,
    replyTo: message.replyTo ?? null,
  });
}

export function decodeMessage(toon: string): Message {
  const raw = decode(toon) as Record<string, unknown>;
  return {
    ...raw,
    replyTo: raw.replyTo === null ? undefined : raw.replyTo,
  } as Message;
}
