import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentPersona } from "core/types";

const AGENTS_CONFIG_PATH = resolve(import.meta.dir, "../../agents.json");

interface AgentConfigEntry {
	name: string;
	skills: string[];
	systemPrompt: string;
	a2a?: { port: number };
}

interface AgentsConfig {
	agents: AgentConfigEntry[];
}

function loadConfig(): AgentsConfig {
	const raw = readFileSync(AGENTS_CONFIG_PATH, "utf-8");
	return JSON.parse(raw);
}

/**
 * Returns the pre-configured agent persona definitions.
 * Registration and starting is handled by the Protocol implementation.
 */
export const CONVERSATION_CONTEXT_NOTE = `

## Conversation Context
This conversation may span multiple turns sharing the same chainId. To understand prior context:
- Use get_message with { chainId, type: "RESPONSE" } to see prior agent answers in this conversation.
- Use get_message with { chainId, type: "REQUEST" } to see prior user questions in this conversation.

When evaluating whether a request matches your skills:
- Vague follow-ups like "what does that mean?", "tell me more", or "explain that" belong to the agent whose domain the conversation has been about. Check prior RESPONSE messages to determine if you were the one answering.
- If another agent already provided a response on a topic, avoid repeating the same information.
- Factor the full conversation history into your responses — refer back to earlier context when relevant.`;

export function createAgentPersonas(): AgentPersona[] {
	const config = loadConfig();
	return config.agents.map(({ name, skills, systemPrompt }) => ({
		name,
		skills,
		systemPrompt,
	}));
}

export function getA2AUrls(): Record<string, string> {
	const config = loadConfig();
	const urls: Record<string, string> = {};
	for (const agent of config.agents) {
		if (agent.a2a) {
			const key = agent.name.split(" - ")[0].toUpperCase();
			const envVar = `A2A_${key}_URL`;
			urls[agent.name] =
				process.env[envVar] ?? `http://localhost:${agent.a2a.port}`;
		}
	}
	return urls;
}
