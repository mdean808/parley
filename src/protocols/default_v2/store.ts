import { log } from "../../logger.ts";
import { decodeMessageV2, encodeMessageV2 } from "./toon.ts";
import type {
	AgentStatus,
	AgentV2,
	Chain,
	Channel,
	MessageFilterV2,
	MessageHandlerV2,
	MessageV2,
	UserV2,
} from "./types.ts";

export class StoreV2 {
	private users: UserV2[] = [];
	private agents: AgentV2[] = [];
	private messages: MessageV2[] = [];
	private chains: Map<string, Chain> = new Map();
	private channels: Map<string, Channel> = new Map();
	private subscribers: Map<string, MessageHandlerV2> = new Map();
	private sequenceCounters: Map<string, number> = new Map();

	registerUser(name: string): UserV2 {
		const user: UserV2 = { id: crypto.randomUUID(), name, channels: [] };
		this.users.push(user);
		log.info("store_v2", "user_registered", { id: user.id, name });
		return user;
	}

	getUser(ids: string[]): UserV2[] {
		return this.users.filter((u) => ids.includes(u.id));
	}

	registerAgent(name: string, skills: string[]): AgentV2 {
		const agent: AgentV2 = {
			id: crypto.randomUUID(),
			name,
			skills,
			channels: [],
			status: "idle",
		};
		this.agents.push(agent);
		log.info("store_v2", "agent_registered", {
			id: agent.id,
			name,
			skills,
		});
		return agent;
	}

	getAgent(ids: string[]): AgentV2[] {
		return this.agents.filter((a) => ids.includes(a.id));
	}

	updateAgentStatus(id: string, status: AgentStatus): void {
		const agent = this.agents.find((a) => a.id === id);
		if (agent) agent.status = status;
	}

	queryAgents(skills: string[]): AgentV2[] {
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

	getNextSequence(agentId: string, chainId: string): number {
		const key = `${agentId}:${chainId}`;
		const current = this.sequenceCounters.get(key) ?? 0;
		this.sequenceCounters.set(key, current + 1);
		return current;
	}

	storeMessage(toonString: string): MessageV2 {
		const decoded = decodeMessageV2(toonString);

		if (decoded.version !== 2) {
			throw new Error(`Invalid version: expected 2, got ${decoded.version}`);
		}

		if (!decoded.type || !decoded.from || !decoded.chainId) {
			throw new Error(
				"Invalid message: missing required fields (type, from, chainId)",
			);
		}

		const message: MessageV2 = {
			...decoded,
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			sequence: this.getNextSequence(decoded.from, decoded.chainId),
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

		// CLAIM handling: first-wins
		if (message.type === "CLAIM") {
			if (!chain) {
				throw new Error(
					`Cannot CLAIM on non-existent chain ${message.chainId}`,
				);
			}
			if (chain.owner) {
				throw new Error(
					`Chain ${message.chainId} already claimed by ${chain.owner}`,
				);
			}
			chain.owner = message.from;
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
		encodeMessageV2(message);

		this.messages.push(message);
		log.debug("store_v2", "message_stored", {
			id: message.id,
			type: message.type,
			chainId: message.chainId,
			from: message.from,
		});

		// Notify subscribers via queueMicrotask
		const senderId = message.from;
		for (const [entityId, handler] of this.subscribers) {
			if (entityId === senderId) continue;
			if (resolvedRecipients.has(entityId)) {
				const toon = encodeMessageV2(message);
				queueMicrotask(() => handler(toon, message));
			}
		}

		return message;
	}

	getMessage(filter: MessageFilterV2): MessageV2[] {
		return this.messages.filter((m) => {
			for (const [key, value] of Object.entries(filter)) {
				if (value === undefined) continue;
				if (key === "to") {
					if (!m.to.includes(value as string)) return false;
				} else if (m[key as keyof MessageV2] !== value) {
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
		log.debug("store_v2", "chain_created", { chainId });
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
		log.debug("store_v2", "channel_created", { id: channel.id, name });
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

	subscribe(entityId: string, handler: MessageHandlerV2): void {
		this.subscribers.set(entityId, handler);
		log.debug("store_v2", "subscribed", { entityId });
	}

	unsubscribe(entityId: string): void {
		this.subscribers.delete(entityId);
		log.debug("store_v2", "unsubscribed", { entityId });
	}

	private validateStateTransition(
		message: MessageV2,
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
				break;
			}
			case "PROCESS": {
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
						"Cannot send PROCESS without a prior ACK for this REQUEST",
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
						"Cannot send ERROR without a prior ACK for this REQUEST",
					);
				}
				break;
			}
		}
	}

	private findChannelByName(name: string): Channel | undefined {
		for (const channel of this.channels.values()) {
			if (channel.name === name) return channel;
		}
		return undefined;
	}
}
