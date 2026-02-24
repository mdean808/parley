import { log } from "./logger.ts";
import type { Agent, Message, MessageFilter, User } from "./types.ts";

export class Store {
	private users: User[] = [];
	private agents: Agent[] = [];
	private messages: Message[] = [];

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

	storeMessage(fields: Omit<Message, "id" | "timestamp">): Message {
		const message: Message = {
			...fields,
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
		};
		this.messages.push(message);
		log.debug("store", "message_stored", { ...message });
		return message;
	}

	getMessages(filter: MessageFilter): Message[] {
		return this.messages.filter((m) => {
			for (const [key, value] of Object.entries(filter)) {
				if (value !== undefined && m[key as keyof Message] !== value)
					return false;
			}
			return true;
		});
	}
}

export const store = new Store();
