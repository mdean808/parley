import type {
	Agent,
	Message,
	MessageFilter,
	MessageHandler,
	User,
} from "../../types.ts";
import { log } from "./logger.ts";
import { decodeMessage, encodeMessage } from "./toon.ts";

/**
 * Central store for users, agents, and messages.
 * Provides pub/sub message delivery.
 */
export class Store {
	private users: User[] = [];
	private agents: Agent[] = [];
	private messages: Message[] = [];
	private subscribers: Map<string, MessageHandler> = new Map();

	/**
	 * Registers a new user with a generated UUID.
	 * @param name - Display name for the user.
	 * @returns The created User.
	 */
	registerUser(name: string): User {
		const user: User = { id: crypto.randomUUID(), name };
		this.users.push(user);
		log.info("store", "user_registered", { id: user.id, name: user.name });
		return user;
	}

	/**
	 * Retrieves users by their IDs.
	 * @param ids - Array of user IDs to look up.
	 * @returns Matching users.
	 */
	getUser(ids: string[]): User[] {
		return this.users.filter((u) => ids.includes(u.id));
	}

	/**
	 * Registers a new agent with a generated UUID.
	 * @param name - Display name for the agent.
	 * @param skills - List of skill identifiers the agent can handle.
	 * @returns The created Agent.
	 */
	registerAgent(name: string, skills: string[]): Agent {
		const agent: Agent = { id: crypto.randomUUID(), name, skills };
		this.agents.push(agent);
		log.info("store", "agent_registered", { id: agent.id, name, skills });
		return agent;
	}

	/**
	 * Retrieves agents by their IDs.
	 * @param ids - Array of agent IDs to look up.
	 * @returns Matching agents.
	 */
	getAgent(ids: string[]): Agent[] {
		return this.agents.filter((a) => ids.includes(a.id));
	}

	/**
	 * Queries agents whose skills match any of the given skill terms.
	 * Uses case-insensitive substring containment in both directions
	 * (query term in skill, or skill in query term).
	 * @param skills - Skill terms to match against.
	 * @returns Agents with at least one matching skill.
	 */
	queryAgents(skills: string[]): Agent[] {
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

	/**
	 * Subscribes an entity (agent or user) to receive messages addressed to it.
	 * @param entityId - The subscriber's ID (agent or user UUID).
	 * @param handler - Callback invoked with the TOON string and decoded message.
	 */
	subscribe(entityId: string, handler: MessageHandler): void {
		this.subscribers.set(entityId, handler);
		log.debug("store", "subscribed", { entityId });
	}

	/**
	 * Removes an entity's subscription.
	 * @param entityId - The subscriber's ID to remove.
	 */
	unsubscribe(entityId: string): void {
		this.subscribers.delete(entityId);
		log.debug("store", "unsubscribed", { entityId });
	}

	/**
	 * Decodes a TOON-encoded message, assigns an id and timestamp, persists it,
	 * and notifies matching subscribers via `queueMicrotask`.
	 *
	 * Broadcast messages (`to: ["*"]`) are delivered to all subscribers except the sender.
	 * Targeted messages are delivered only to listed recipients.
	 *
	 * @param toonString - The TOON-encoded message string (id/timestamp may be placeholders).
	 * @returns The persisted Message with assigned id and timestamp.
	 */
	sendMessage(toonString: string): Message {
		const decoded = decodeMessage(toonString);

		const message: Message = {
			...decoded,
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
		};

		// Validate by re-encoding — rejects malformed messages per spec
		const completeToon = encodeMessage(message);

		this.messages.push(message);
		log.debug("store", "message_stored", { toon: completeToon });

		// Notify subscribers via queueMicrotask to prevent re-entrant issues
		const senderId = message.from;
		const isBroadcast = message.to.includes("*");

		for (const [entityId, handler] of this.subscribers) {
			if (entityId === senderId) continue;
			if (isBroadcast || message.to.includes(entityId)) {
				queueMicrotask(() => handler(completeToon, message));
			}
		}

		return message;
	}

	/**
	 * Queries stored messages matching the given filter criteria.
	 * All specified fields are ANDed together. The `to` field matches if the
	 * message's recipient list includes the given value.
	 * @param filter - Partial message fields to match against.
	 * @returns Messages matching all filter criteria.
	 */
	getMessages(filter: MessageFilter): Message[] {
		return this.messages.filter((m) => {
			for (const [key, value] of Object.entries(filter)) {
				if (value === undefined) continue;
				if (key === "to") {
					if (!m.to.includes(value as string)) return false;
				} else if (m[key as keyof Message] !== value) {
					return false;
				}
			}
			return true;
		});
	}
}

export const store = new Store();
