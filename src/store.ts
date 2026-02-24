import type { User, Agent, Message, MessageFilter } from "./types.ts";

const users: User[] = [];
const agents: Agent[] = [];
const messages: Message[] = [];

export function registerUser(name: string): User {
  const user: User = { id: crypto.randomUUID(), name };
  users.push(user);
  return user;
}

export function getUser(ids: string[]): User[] {
  return users.filter((u) => ids.includes(u.id));
}

export function registerAgent(name: string, skills: string[]): Agent {
  const agent: Agent = { id: crypto.randomUUID(), name, skills };
  agents.push(agent);
  return agent;
}

export function getAgent(ids: string[]): Agent[] {
  return agents.filter((a) => ids.includes(a.id));
}

export function getAllAgents(): Agent[] {
  return [...agents];
}

export function queryAgents(skills: string[]): Agent[] {
  return agents.filter((a) =>
    skills.some((skill) => a.skills.includes(skill))
  );
}

export function storeMessage(
  fields: Omit<Message, "id" | "timestamp">
): Message {
  const message: Message = {
    ...fields,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  messages.push(message);
  return message;
}

export function getMessages(filter: MessageFilter): Message[] {
  return messages.filter((m) => {
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && m[key as keyof Message] !== value) return false;
    }
    return true;
  });
}
