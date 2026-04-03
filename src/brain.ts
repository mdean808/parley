import { client, MODEL } from "./config.ts";
import type {
	AgentBrain,
	BrainRequest,
	BrainResponse,
	DelegationRequest,
	DelegationResult,
	SkillEvalResult,
} from "./types.ts";

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
	async shouldHandle(request: BrainRequest): Promise<SkillEvalResult> {
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

		if (neededSkills.length === 0) return { relevant: true, neededSkills: [] };

		const relevant = neededSkills.some((skill) =>
			request.agent.skills.includes(skill),
		);
		return { relevant, neededSkills };
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

	/**
	 * Asks the LLM whether the request would benefit from delegation to
	 * other agents with different skills. Returns a DelegationRequest
	 * with target skills and a question payload, or null if no delegation needed.
	 */
	async shouldDelegate(
		request: BrainRequest,
	): Promise<DelegationRequest | null> {
		const otherSkills = request.allSkills.filter(
			(s) => !request.agent.skills.includes(s),
		);
		if (otherSkills.length === 0) return null;

		const completion = await client.messages.create({
			model: MODEL,
			max_tokens: 256,
			messages: [
				{
					role: "user",
					content: `You are "${request.agent.name}" with skills: ${request.agent.skills.join(", ")}.

A user asked: "${request.payload}"

Other agents have these skills: ${otherSkills.join(", ")}

Would this request benefit from asking agents with those other skills? If yes, respond with JSON: {"delegate": true, "targetSkills": ["skill1"], "question": "what to ask them"}
If no, respond with: {"delegate": false}

Respond with ONLY valid JSON, nothing else.`,
				},
			],
		});

		const text =
			completion.content[0].type === "text" ? completion.content[0].text : "";

		try {
			const parsed = JSON.parse(text);
			if (parsed.delegate && parsed.targetSkills?.length > 0) {
				return {
					payload: parsed.question || request.payload,
					targetSkills: parsed.targetSkills,
				};
			}
		} catch {
			// LLM didn't produce valid JSON, treat as no delegation
		}

		return null;
	}

	/**
	 * Synthesizes a final response from the original request and the
	 * collected delegation results from other agents.
	 */
	async generateDelegatedResponse(
		request: BrainRequest,
		delegationResults: DelegationResult[],
	): Promise<BrainResponse> {
		const delegationContext = delegationResults
			.map((r) => `[${r.agentName}] (${r.type}): ${r.payload}`)
			.join("\n\n");

		const start: number = performance.now();
		const completion = await client.messages.create({
			model: MODEL,
			max_tokens: 1024,
			system: this.systemPrompt,
			messages: [
				{
					role: "user",
					content: `Original request: ${request.rawMessage}

I consulted other agents and received these responses:

${delegationContext}

Please synthesize a comprehensive response to the original request, incorporating the insights from the other agents.`,
				},
			],
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
