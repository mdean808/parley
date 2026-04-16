import type { Protocol } from "core/types";

/**
 * Offline protocol-integrity checker. Runs against parley's in-memory store
 * after a probe completes and validates the invariants the spec claims:
 *
 *   1. Per-(agent, chain) sequence numbers are monotonic and gapless starting at 0.
 *   2. Every REQUEST has at least one ACK per addressed recipient.
 *
 * Returns a summary plus a list of violations. Non-parley protocols return
 * undefined (structural mismatch on `store.getMessage`).
 */

export interface InvariantViolation {
	rule: "sequence-gap" | "missing-ack";
	detail: string;
}

export interface InvariantSummary {
	passed: boolean;
	checkedMessages: number;
	violations: InvariantViolation[];
}

interface ParleyWireMessage {
	id: string;
	chainId: string;
	sequence: number;
	type: string;
	from: string;
	to: string[];
	replyTo?: string;
}

interface ParleyStoreView {
	getMessage: (filter: { chainId?: string }) => ParleyWireMessage[];
}

function getParleyStore(protocol: Protocol): ParleyStoreView | undefined {
	const candidate = (protocol as unknown as { store?: unknown }).store as
		| ParleyStoreView
		| undefined;
	if (!candidate || typeof candidate.getMessage !== "function")
		return undefined;
	return candidate;
}

export function checkParleyInvariants(
	protocol: Protocol,
	chainId: string,
): InvariantSummary | undefined {
	const store = getParleyStore(protocol);
	if (!store) return undefined;

	const messages = store.getMessage({ chainId });
	if (messages.length === 0) {
		return { passed: true, checkedMessages: 0, violations: [] };
	}

	const violations: InvariantViolation[] = [];

	// (1) Sequence gapless check per (from, chainId)
	const bySender = new Map<string, ParleyWireMessage[]>();
	for (const m of messages) {
		const key = `${m.from}:${m.chainId}`;
		if (!bySender.has(key)) bySender.set(key, []);
		const list = bySender.get(key);
		if (list) list.push(m);
	}
	for (const [key, list] of bySender) {
		list.sort((a, b) => a.sequence - b.sequence);
		for (let i = 0; i < list.length; i++) {
			if (list[i].sequence !== i) {
				violations.push({
					rule: "sequence-gap",
					detail: `${key} has sequence ${list[i].sequence} at index ${i} (expected ${i}); messages: ${list
						.map((m) => m.sequence)
						.join(", ")}`,
				});
				break; // one gap per sender is enough
			}
		}
	}

	// (2) Every REQUEST has an ACK from each addressed recipient (unicast or
	// broadcast → at least one ACK). "*" addresses are treated as broadcast;
	// we skip them since we can't enumerate expected responders without registry.
	const requests = messages.filter((m) => m.type === "REQUEST");
	for (const req of requests) {
		const unicastTargets = req.to.filter((t) => t !== "*");
		if (unicastTargets.length === 0) continue; // broadcast — skip hard check
		for (const target of unicastTargets) {
			const hasAck = messages.some(
				(m) => m.type === "ACK" && m.from === target && m.replyTo === req.id,
			);
			if (!hasAck) {
				violations.push({
					rule: "missing-ack",
					detail: `REQUEST ${req.id} addressed to ${target} never received an ACK`,
				});
			}
		}
	}

	return {
		passed: violations.length === 0,
		checkedMessages: messages.length,
		violations,
	};
}
