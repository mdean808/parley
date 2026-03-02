import Anthropic from "@anthropic-ai/sdk";
import type { AgentBrain, BrainRequest, BrainResponse } from "./types.ts";

const MODEL: string = process.env.MODEL || "claude-haiku-4-5-20251001";
const client: Anthropic = new Anthropic();

/**
 * LLM-powered brain that evaluates skill relevance and generates responses
 * using the Anthropic Claude SDK. Implements the AgentBrain interface so it
 * can be injected into any protocol implementation.
 */
export class ClaudeBrain implements AgentBrain {
	readonly systemPrompt: string;

	constructor(systemPrompt: string) {
		this.systemPrompt = systemPrompt;
	}

	/**
	 * Uses an LLM call to determine which skills from across all agents are relevant
	 * to the request, then checks whether the requesting agent holds any of those skills.
	 * Returns true if no skills are identified (fallback: handle everything).
	 */
	async shouldHandle(request: BrainRequest): Promise<boolean> {
		const completion = await client.messages.create({
			model: MODEL,
			max_tokens: 100,
			messages: [
				{
					role: "user",
					content: `Given this request: "${request.payload}"

Which of these skills are relevant? ${request.allSkills.join(", ")}

Reply with ONLY the relevant skill names, comma-separated. If none match, reply "none".`,
				},
			],
		});

		const responseText: string =
			completion.content[0].type === "text" ? completion.content[0].text : "";
		const neededSkills: string[] = responseText
			.toLowerCase()
			.split(",")
			.map((s) => s.trim())
			.filter((s) => request.allSkills.includes(s));

		if (neededSkills.length === 0) return true;

		return neededSkills.some((skill) => request.agent.skills.includes(skill));
	}

	/**
	 * Makes the main LLM call using the raw TOON message as user content.
	 * Returns the response text along with usage/timing metadata.
	 */
	async generateResponse(request: BrainRequest): Promise<BrainResponse> {
		const start: number = performance.now();
		const completion = await client.messages.create({
			model: MODEL,
			max_tokens: 1024,
			system: this.systemPrompt,
			messages: [{ role: "user", content: request.rawMessage }],
		});
		const durationMs: number = performance.now() - start;

		const text: string =
			completion.content[0].type === "text" ? completion.content[0].text : "";

		return {
			text,
			meta: {
				usage: {
					inputTokens: completion.usage.input_tokens,
					outputTokens: completion.usage.output_tokens,
				},
				model: MODEL,
				durationMs,
			},
		};
	}
}
