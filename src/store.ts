import { log } from "./logger.ts";
import { decodeMessage, encodeMessage } from "./toon.ts";
import type {
	Agent,
	Message,
	MessageFilter,
	MessageHandler,
	MessageMeta,
	User,
} from "./types.ts";

export class Store {
	private users: User[] = [];
	private agents: Agent[] = [];
	private messages: Message[] = [];
	private subscribers: Map<string, MessageHandler> = new Map();
	private messageMeta: Map<string, MessageMeta> = new Map();

	registerUser(name: string): User {
		const user: User = { id: crypto.randomUUID(), name };
		this.users.push(user);
		log.info("store", "user_registered", { id: user.id, name: user.name });
		return user;
	}

	getUser(ids: string[]): User[] {
		return this.users.filter((u) => ids.includes(u.id));
	}

	registerAgent(name: string, skills: string[]): Agent {
		const agent: Agent = { id: crypto.randomUUID(), name, skills };
		this.agents.push(agent);
		log.info("store", "agent_registered", { id: agent.id, name, skills });
		return agent;
	}

	getAgent(ids: string[]): Agent[] {
		return this.agents.filter((a) => ids.includes(a.id));
	}

	getAllAgents(): Agent[] {
		return [...this.agents];
	}

	queryAgents(skills: string[]): Agent[] {
		return this.agents.filter((a) =>
			skills.some((skill) => a.skills.includes(skill)),
		);
	}

	subscribe(entityId: string, handler: MessageHandler): void {
		this.subscribers.set(entityId, handler);
		log.debug("store", "subscribed", { entityId });
	}

	unsubscribe(entityId: string): void {
		this.subscribers.delete(entityId);
		log.debug("store", "unsubscribed", { entityId });
	}

	setMessageMeta(messageId: string, meta: MessageMeta): void {
		this.messageMeta.set(messageId, meta);
	}

	getMessageMeta(messageId: string): MessageMeta | undefined {
		return this.messageMeta.get(messageId);
	}

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
		log.debug("store", "message_stored", { ...message });

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
