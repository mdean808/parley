import type { ScenarioConfig } from "./types.ts";

export const DEFAULT_SCENARIOS: ScenarioConfig[] = [
	{
		name: "research-only",
		topic: "French Revolution",
		rounds: [
			{ prompt: "What were the main causes of the French Revolution?" },
			{
				prompt:
					"How did the economic crisis of the 1780s specifically contribute to revolutionary sentiment?",
			},
		],
	},
	{
		name: "creative-only",
		topic: "Haiku writing",
		rounds: [
			{ prompt: "Write a haiku about the silence between musical notes." },
			{
				prompt:
					"Now rewrite that haiku from the perspective of the instrument itself.",
			},
		],
	},
	{
		name: "technical-only",
		topic: "Hash maps",
		rounds: [
			{
				prompt:
					"Explain how a hash map works internally, including collision resolution strategies.",
			},
			{
				prompt:
					"Implement a basic hash map in TypeScript with separate chaining for collision resolution.",
			},
		],
	},
	{
		name: "mixed-cross-domain",
		topic: "Quantum computing",
		rounds: [
			{
				prompt:
					"What is quantum computing and how does it differ from classical computing?",
			},
			{
				prompt:
					"Write a creative analogy or short story that explains quantum superposition to a child.",
			},
			{
				prompt:
					"Show a simple code example of a quantum circuit simulation using basic TypeScript.",
			},
		],
	},
];

export const MULTI_ROUND_SCENARIOS: ScenarioConfig[] = [
	{
		name: "multi-round-deepening",
		topic: "Climate change solutions",
		rounds: [
			{
				prompt:
					"What are the most promising approaches to addressing climate change?",
			},
		],
		multiRound: {
			rounds: 3,
		},
	},
	{
		name: "agent-debate",
		topic: "AI consciousness",
		rounds: [
			{
				prompt:
					"Is it possible for an artificial intelligence to be truly conscious? Why or why not?",
			},
		],
		multiRound: {
			rounds: 4,
			followUpInstruction:
				"Respond to the other agents' points and provide your updated analysis.",
			crossAgentContext: true,
		},
	},
	{
		name: "follow-up-chain",
		topic: "REST API design",
		rounds: [
			{
				prompt: "What are the key principles of good REST API design?",
			},
		],
		multiRound: {
			rounds: 2,
		},
	},
	{
		name: "build-rest-node",
		topic: "REST API program",
		rounds: [
			{
				prompt:
					"Provide the code for a simple REST API (GET /, POST /, GET /health) that returns the last thing POSTed (or nil if none). Use vanilla NodeJs.",
			},
		],
		multiRound: {
			rounds: 2,
		},
	},
];
