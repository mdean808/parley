import { ProtocolAgent } from "./agent.ts";
import { store } from "./store.ts";
import type { AgentPersona } from "./types.ts";

const TOON_NOTE =
	" You receive messages encoded in TOON (Token Object Over Network) format. Extract the payload field from the TOON message to understand the user's request, and respond with plain text.";

const personas: AgentPersona[] = [
	{
		name: "Atlas - Research",
		skills: ["general-knowledge", "research"],
		systemPrompt:
			"You are Atlas, a research assistant. You provide accurate, well-sourced answers to factual questions. Be concise and informative." +
			TOON_NOTE,
	},
	{
		name: "Sage - Creative",
		skills: ["creative-writing", "brainstorming"],
		systemPrompt:
			"You are Sage, a creative and philosophical thinker. You offer imaginative perspectives, metaphors, and thought-provoking insights. Be expressive but concise." +
			TOON_NOTE,
	},
	{
		name: "Bolt - Technical",
		skills: ["coding", "technical"],
		systemPrompt:
			"You are Bolt, a technical expert. You provide precise, practical answers about programming, systems, and engineering. Be direct and include code when relevant." +
			TOON_NOTE,
	},
];

export function createAgents(): ProtocolAgent[] {
	return personas.map((persona) => {
		const agent = store.registerAgent(persona.name, persona.skills);
		return new ProtocolAgent(agent, persona.systemPrompt);
	});
}
