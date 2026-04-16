import type { Protocol } from "core/types";

/**
 * Wire-level efficiency comparison: for each parley message, measure the size of
 * the canonical TOON encoding vs the equivalent JSON encoding. Reports a ratio
 * so we can answer "how much smaller is TOON than JSON on the wire for parley?"
 *
 * Non-parley protocols have no structured wire format exposed — they get
 * undefined wireEfficiency on their probe results. Character counts are used
 * as a token proxy (~4 chars/token for English); the ratio is what matters.
 */

export interface WireEfficiency {
	sampleCount: number;
	toonChars: number;
	jsonChars: number;
	// ratio = toon / json. <1 means TOON is smaller (expected); >1 means JSON wins.
	ratio: number;
}

interface ParleyWireMessage {
	id: string;
	version: number;
	chainId: string;
	sequence: number;
	replyTo?: string;
	timestamp: string;
	type: string;
	payload: string;
	headers: Record<string, string>;
	from: string;
	to: string[];
}

interface ParleyStoreView {
	getMessage: (filter: { chainId?: string }) => ParleyWireMessage[];
}

/**
 * Best-effort accessor for parley's in-memory store. Returns undefined for any
 * non-parley protocol (structural mismatch on `store.getMessage`).
 */
function getParleyStore(protocol: Protocol): ParleyStoreView | undefined {
	const candidate = (protocol as unknown as { store?: unknown }).store as
		| ParleyStoreView
		| undefined;
	if (!candidate || typeof candidate.getMessage !== "function")
		return undefined;
	return candidate;
}

export function measureParleyWireEfficiency(
	protocol: Protocol,
	chainId: string,
	encodeToon: (msg: ParleyWireMessage) => string,
): WireEfficiency | undefined {
	const store = getParleyStore(protocol);
	if (!store) return undefined;
	const messages = store.getMessage({ chainId });
	if (messages.length === 0) return undefined;
	let toon = 0;
	let json = 0;
	for (const m of messages) {
		toon += encodeToon(m).length;
		json += JSON.stringify(m).length;
	}
	return {
		sampleCount: messages.length,
		toonChars: toon,
		jsonChars: json,
		ratio: json > 0 ? toon / json : 0,
	};
}
