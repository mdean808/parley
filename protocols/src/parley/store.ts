import { log } from "../logger.ts";
import { decodeMessageParley, encodeMessageParley } from "./toon.ts";
import type {
	AgentParley,
	AgentStatus,
	Chain,
	Channel,
	MessageFilterParley,
	MessageHandlerParley,
	MessageParley,
	UserParley,
} from "./types.ts";

// Reserved sender id for store-synthesized messages (e.g. CLAIM-rejection
// ERRORs). Never a registered agent/user; agents must not spoof it.
export const STORE_SENDER = "store";

export class StoreParley {
	private users: UserParley[] = [];
	private agents: AgentParley[] = [];
	private messages: MessageParley[] = [];
	private chains: Map<string, Chain> = new Map();
	private channels: Map<string, Channel> = new Map();
	private subscribers: Map<string, MessageHandlerParley> = new Map();
	// Per-chain, per-sender next sequence counter. Store-assigned sequence is
	// authoritative per spec §Sequencing; agents send an intended value but
	// this counter overwrites.
	private sequenceCounters: Map<string, Map<string, number>> = new Map();

	registerUser(name: string): UserParley {
		const user: UserParley = { id: crypto.randomUUID(), name, channels: [] };
		this.users.push(user);
		log.info("store_parley", "user_registered", { id: user.id, name });
		return user;
	}

	getUser(ids: string[]): UserParley[] {
		return this.users.filter((u) => ids.includes(u.id));
	}

	registerAgent(name: string, skills: string[]): AgentParley {
		const agent: AgentParley = {
			id: crypto.randomUUID(),
			name,
			skills,
			channels: [],
			status: "idle",
		};
		this.agents.push(agent);
		log.info("store_parley", "agent_registered", {
			id: agent.id,
			name,
			skills,
		});
		return agent;
	}

	getAgent(ids: string[]): AgentParley[] {
		return this.agents.filter((a) => ids.includes(a.id));
	}

	updateAgentStatus(id: string, status: AgentStatus): void {
		const agent = this.agents.find((a) => a.id === id);
		if (agent) agent.status = status;
	}

	queryAgents(skills: string[]): AgentParley[] {
		const lowerSkills = skills.map((s) => s.toLowerCase());
		return this.agents.filter((agent) =>
			agent.skills.some((agentSkill) => {
				const lower = agentSkill.toLowerCase();
				return lowerSkills.some(
					(qs) => lower.includes(qs) || qs.includes(lower),
				);
			}),
		);
	}

	storeMessage(toonString: string): MessageParley {
		const decoded = decodeMessageParley(toonString);

		if (decoded.version !== 2) {
			if (decoded.version === undefined) {
				throw new Error(
					"Missing protocol version; expected 2. Pre-v2 messages omit this field and are rejected per spec §Versioning.",
				);
			}
			throw new Error(
				`Unsupported protocol version: got ${decoded.version}, expected 2`,
			);
		}

		if (!decoded.type || !decoded.from || !decoded.chainId) {
			throw new Error(
				"Invalid message: missing required fields (type, from, chainId)",
			);
		}

		const message: MessageParley = {
			...decoded,
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			sequence: this.nextSequence(decoded.chainId, decoded.from),
		};

		// Chain enforcement
		let chain = this.chains.get(message.chainId);

		if (chain?.status === "cancelled") {
			if (message.type === "ACK" && message.replyTo) {
				const replyTarget = this.messages.find((m) => m.id === message.replyTo);
				if (!replyTarget || replyTarget.type !== "CANCEL") {
					throw new Error(
						`Chain ${message.chainId} is cancelled. Only ACK of CANCEL allowed.`,
					);
				}
			} else {
				throw new Error(
					`Chain ${message.chainId} is cancelled. Only ACK of CANCEL allowed.`,
				);
			}
		}

		// Auto-create chain on first REQUEST
		if (message.type === "REQUEST" && !chain) {
			chain = this.createChain(message.chainId, message.timestamp);
		}

		// CLAIM handling: first-wins resolution. A CLAIM on a chain that
		// already has an owner is stored (it is a valid protocol message), but
		// the claimant is immediately notified of rejection via a
		// store-synthesized ERROR (spec §CLAIM step 7).
		let claimJustResolved = false;
		let claimLoser = false;
		if (message.type === "CLAIM") {
			if (!chain) {
				throw new Error(
					`Cannot CLAIM on non-existent chain ${message.chainId}`,
				);
			}
			if (chain.owner && chain.owner !== message.from) {
				claimLoser = true;
			} else if (!chain.owner) {
				chain.owner = message.from;
				claimJustResolved = true;
			}
			// chain.owner === message.from: duplicate CLAIM by same agent — idempotent
		}

		// TTL enforcement — check if chain has expired
		if (chain && message.type !== "REQUEST") {
			const originRequest = this.messages.find(
				(m) =>
					m.chainId === message.chainId && m.type === "REQUEST" && !m.replyTo,
			);
			const ttl = originRequest?.headers?.ttl;
			if (ttl && new Date() > new Date(ttl)) {
				chain.status = "expired";
				throw new Error(
					`Chain ${message.chainId} expired: TTL ${ttl} exceeded`,
				);
			}
		}

		// CANCEL handling — only original requester or chain owner may cancel
		if (message.type === "CANCEL") {
			if (chain) {
				const originRequest = this.messages.find(
					(m) =>
						m.chainId === message.chainId && m.type === "REQUEST" && !m.replyTo,
				);
				const isRequester = originRequest?.from === message.from;
				const isOwner = chain.owner === message.from;
				if (!isRequester && !isOwner) {
					throw new Error(
						`Only the original requester or chain owner may CANCEL chain ${message.chainId}`,
					);
				}
				chain.status = "cancelled";
			}
		}

		// State transition validation
		this.validateStateTransition(message, chain);

		// Target resolution (spec order: ID -> channel -> broadcast)
		const resolvedRecipients = new Set<string>();
		for (const target of message.to) {
			if (
				this.agents.some((a) => a.id === target) ||
				this.users.some((u) => u.id === target)
			) {
				resolvedRecipients.add(target);
			} else if (this.channels.has(target)) {
				const ch = this.channels.get(target);
				if (ch) {
					for (const member of ch.members) resolvedRecipients.add(member);
				}
			} else if (this.findChannelByName(target)) {
				const ch = this.findChannelByName(target);
				if (ch) {
					for (const member of ch.members) resolvedRecipients.add(member);
				}
			} else if (target === "*") {
				for (const agent of this.agents) resolvedRecipients.add(agent.id);
				for (const user of this.users) resolvedRecipients.add(user.id);
			} else {
				throw new Error(
					`Target resolution failed: "${target}" matches no agent, user, or channel`,
				);
			}
		}

		// Re-encode for validation
		encodeMessageParley(message);

		this.messages.push(message);
		log.debug("store_parley", "message_stored", {
			id: message.id,
			type: message.type,
			chainId: message.chainId,
			from: message.from,
			to: message.to,
			headers: message.headers,
			payload: message.payload,
			replyTo: message.replyTo,
		});

		// Notify subscribers via queueMicrotask
		const senderId = message.from;
		for (const [entityId, handler] of this.subscribers) {
			if (entityId === senderId) continue;
			if (resolvedRecipients.has(entityId)) {
				const toon = encodeMessageParley(message);
				queueMicrotask(() => handler(toon, message));
			}
		}

		// Per spec §CLAIM step 7: emit a store-synthesized ERROR to each
		// non-winner CLAIMant. Under first-wins, the winner's CLAIM has no
		// priors (emitClaimRejections is a no-op on the winning write), and
		// later CLAIMants are rejected inline via claimLoser.
		if (claimJustResolved && chain) {
			this.emitClaimRejections(message.chainId, message.from);
		}
		if (claimLoser && chain?.owner) {
			this.emitRejectionFor(
				message.chainId,
				message.id,
				message.from,
				chain.owner,
			);
		}

		return message;
	}

	private emitClaimRejections(chainId: string, winnerId: string): void {
		const priorClaims = this.messages.filter(
			(m) =>
				m.chainId === chainId && m.type === "CLAIM" && m.from !== winnerId,
		);
		for (const claim of priorClaims) {
			// Skip if this loser already received a rejection (idempotent).
			const alreadyRejected = this.messages.some(
				(m) =>
					m.chainId === chainId &&
					m.type === "ERROR" &&
					m.from === STORE_SENDER &&
					m.replyTo === claim.id,
			);
			if (alreadyRejected) continue;
			this.emitRejectionFor(chainId, claim.id, claim.from, winnerId);
		}
	}

	private emitRejectionFor(
		chainId: string,
		claimId: string,
		claimantId: string,
		winnerId: string,
	): void {
		const error: MessageParley = {
			id: crypto.randomUUID(),
			version: 2,
			chainId,
			sequence: this.nextSequence(chainId, STORE_SENDER),
			replyTo: claimId,
			timestamp: new Date().toISOString(),
			type: "ERROR",
			payload: `CLAIM rejected; owner is ${winnerId}`,
			headers: {},
			from: STORE_SENDER,
			to: [claimantId],
		};
		this.messages.push(error);
		log.debug("store_parley", "claim_rejected_emitted", {
			chainId,
			to: claimantId,
			winner: winnerId,
			claimId,
		});
		const handler = this.subscribers.get(claimantId);
		if (handler) {
			const toon = encodeMessageParley(error);
			queueMicrotask(() => handler(toon, error));
		}
	}

	getMessage(filter: MessageFilterParley): MessageParley[] {
		return this.messages.filter((m) => {
			for (const [key, value] of Object.entries(filter)) {
				if (value === undefined) continue;
				if (key === "to") {
					if (!m.to.includes(value as string)) return false;
				} else if (m[key as keyof MessageParley] !== value) {
					return false;
				}
			}
			return true;
		});
	}

	createChain(chainId: string, createdAt: string): Chain {
		const chain: Chain = {
			chainId,
			owner: undefined,
			status: "active",
			createdAt,
		};
		this.chains.set(chainId, chain);
		log.debug("store_parley", "chain_created", { chainId });
		return chain;
	}

	getChain(chainId: string): Chain | undefined {
		return this.chains.get(chainId);
	}

	updateChain(
		chainId: string,
		updates: Partial<Pick<Chain, "owner" | "status">>,
	): Chain {
		const chain = this.chains.get(chainId);
		if (!chain) throw new Error(`Chain ${chainId} not found`);
		Object.assign(chain, updates);
		return chain;
	}

	createChannel(name: string, members: string[] = []): Channel {
		if (this.findChannelByName(name)) {
			throw new Error(`Channel "${name}" already exists`);
		}
		const channel: Channel = { id: crypto.randomUUID(), name, members };
		this.channels.set(channel.id, channel);
		log.debug("store_parley", "channel_created", { id: channel.id, name });
		return channel;
	}

	getChannel(idOrName: string): Channel | undefined {
		return this.channels.get(idOrName) ?? this.findChannelByName(idOrName);
	}

	joinChannel(channelIdOrName: string, entityId: string): void {
		const channel = this.getChannel(channelIdOrName);
		if (!channel) throw new Error(`Channel "${channelIdOrName}" not found`);
		if (!channel.members.includes(entityId)) {
			channel.members.push(entityId);
		}
		// Update agent/user channels list
		const agent = this.agents.find((a) => a.id === entityId);
		if (agent && !agent.channels.includes(channel.name)) {
			agent.channels.push(channel.name);
		}
		const user = this.users.find((u) => u.id === entityId);
		if (user && !user.channels.includes(channel.name)) {
			user.channels.push(channel.name);
		}
	}

	leaveChannel(channelIdOrName: string, entityId: string): void {
		const channel = this.getChannel(channelIdOrName);
		if (!channel) throw new Error(`Channel "${channelIdOrName}" not found`);
		channel.members = channel.members.filter((m) => m !== entityId);
		const agent = this.agents.find((a) => a.id === entityId);
		if (agent) {
			agent.channels = agent.channels.filter((c) => c !== channel.name);
		}
		const user = this.users.find((u) => u.id === entityId);
		if (user) {
			user.channels = user.channels.filter((c) => c !== channel.name);
		}
	}

	listChannels(filter?: { memberId?: string }): Channel[] {
		const all = Array.from(this.channels.values());
		if (filter?.memberId) {
			const id = filter.memberId;
			return all.filter((c) => c.members.includes(id));
		}
		return all;
	}

	subscribe(entityId: string, handler: MessageHandlerParley): void {
		this.subscribers.set(entityId, handler);
		log.debug("store_parley", "subscribed", { entityId });
	}

	unsubscribe(entityId: string): void {
		this.subscribers.delete(entityId);
		log.debug("store_parley", "unsubscribed", { entityId });
	}

	private validateStateTransition(
		message: MessageParley,
		chain: Chain | undefined,
	): void {
		// REQUEST and CANCEL are always valid at the store level
		// (CANCEL authorization is checked separately above)
		if (message.type === "REQUEST" || message.type === "CANCEL") return;

		if (!chain) {
			throw new Error(
				`Cannot send ${message.type} on non-existent chain ${message.chainId}`,
			);
		}

		// All non-REQUEST messages must have a replyTo
		if (!message.replyTo) {
			throw new Error(`${message.type} message must have a replyTo field`);
		}

		const replyTarget = this.messages.find((m) => m.id === message.replyTo);
		if (!replyTarget) {
			throw new Error(
				`replyTo ${message.replyTo} references a non-existent message`,
			);
		}

		// Find the REQUEST this lifecycle is responding to
		const requestId =
			replyTarget.type === "REQUEST" || replyTarget.type === "CANCEL"
				? replyTarget.id
				: replyTarget.replyTo;

		switch (message.type) {
			case "ACK": {
				// ACK must reply to a REQUEST or CANCEL
				if (replyTarget.type !== "REQUEST" && replyTarget.type !== "CANCEL") {
					throw new Error("ACK must reply to a REQUEST or CANCEL message");
				}
				// Per spec §Headers: `accept` is required on ACK-of-REQUEST.
				// ACK-of-CANCEL is bookkeeping and does not require it.
				if (replyTarget.type === "REQUEST") {
					const accept = message.headers?.accept;
					if (accept !== "true" && accept !== "false") {
						throw new Error(
							`ACK replying to REQUEST must include header 'accept' set to "true" or "false" (got ${accept === undefined ? "missing" : JSON.stringify(accept)})`,
						);
					}
				}
				break;
			}
			case "PROCESS": {
				// Per spec §Constraints: PROCESS requires a prior ACK with
				// `accept: true` from the same agent replying to the same
				// REQUEST. Per S1, an agent MAY have earlier declined (accept:
				// false) and later re-ACKed — as long as at least one ACK with
				// accept=true exists, PROCESS is allowed.
				const hasAcceptingAck = this.messages.some(
					(m) =>
						m.chainId === message.chainId &&
						m.from === message.from &&
						m.type === "ACK" &&
						m.replyTo === requestId &&
						m.headers?.accept === "true",
				);
				if (!hasAcceptingAck) {
					throw new Error(
						"Cannot send PROCESS without a prior ACK (accept: true) for this REQUEST",
					);
				}
				// Ownership check
				if (chain.owner && chain.owner !== message.from) {
					throw new Error(
						`Agent ${message.from} does not own chain ${message.chainId}`,
					);
				}
				break;
			}
			case "RESPONSE": {
				// Sender must have sent PROCESS for the same REQUEST
				const hasProcess = this.messages.some(
					(m) =>
						m.chainId === message.chainId &&
						m.from === message.from &&
						m.type === "PROCESS" &&
						m.replyTo === requestId,
				);
				if (!hasProcess) {
					throw new Error(
						"Cannot send RESPONSE without a prior PROCESS for this REQUEST",
					);
				}
				// Ownership check
				if (chain.owner && chain.owner !== message.from) {
					throw new Error(
						`Agent ${message.from} does not own chain ${message.chainId}`,
					);
				}
				break;
			}
			case "CLAIM": {
				// Sender must have ACK'd the same REQUEST
				const hasAck = this.messages.some(
					(m) =>
						m.chainId === message.chainId &&
						m.from === message.from &&
						m.type === "ACK" &&
						m.replyTo === requestId,
				);
				if (!hasAck) {
					throw new Error(
						"Cannot send CLAIM without a prior ACK for this REQUEST",
					);
				}
				// The REQUEST must have exclusivity: true
				const originRequest = this.messages.find((m) => m.id === requestId);
				if (originRequest?.headers?.exclusivity !== "true") {
					throw new Error(
						"Cannot send CLAIM on a REQUEST without exclusivity: true header",
					);
				}
				break;
			}
			case "ERROR": {
				// ERROR is valid at any point in the chain — per spec §Agent
				// Message States, REQUEST → ERROR is a valid terminal (pre-ACK
				// rejection for version mismatch, expired TTL, validation
				// failure). Only require that the reply target exists, which
				// was already verified above.
				break;
			}
		}
	}

	// Per spec §Sequencing: store assigns a per-(chain, sender) monotonic counter.
	// Callers' intended `sequence` values are overwritten by the return of this method.
	private nextSequence(chainId: string, from: string): number {
		let perChain = this.sequenceCounters.get(chainId);
		if (!perChain) {
			perChain = new Map();
			this.sequenceCounters.set(chainId, perChain);
		}
		const current = perChain.get(from) ?? 0;
		perChain.set(from, current + 1);
		return current;
	}

	private findChannelByName(name: string): Channel | undefined {
		for (const channel of this.channels.values()) {
			if (channel.name === name) return channel;
		}
		return undefined;
	}
}
