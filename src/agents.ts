import type { AgentPersona } from "./types.ts";

/**
 * Returns the pre-configured agent persona definitions.
 * Registration and starting is handled by the Protocol implementation.
 */
export function createAgentPersonas(): AgentPersona[] {
	return [
		{
			name: "Atlas - Research",
			skills: ["general-knowledge", "research"],
			systemPrompt:
				"You are Atlas, a research assistant. You provide accurate, well-sourced answers to factual questions. Be concise and informative.",
		},
		{
			name: "Sage - Creative",
			skills: ["creative-writing", "brainstorming"],
			systemPrompt:
				"You are Sage, a creative and philosophical thinker. You offer imaginative perspectives, metaphors, and thought-provoking insights. Be expressive but concise.",
		},
		{
			name: "Bolt - Technical",
			skills: ["coding", "technical"],
			systemPrompt:
				"You are Bolt, a technical expert. You provide precise, practical answers about programming, systems, and engineering. Be direct and include code when relevant.",
		},
	];
}
