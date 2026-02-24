import Anthropic from "@anthropic-ai/sdk";
import { log } from "./logger.ts";
import { store } from "./store.ts";
import { encodeMessage } from "./toon.ts";
import type { Agent, AgentResult, Message } from "./types.ts";

const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const client = new Anthropic();

export class ProtocolAgent {
	agent: Agent;
	systemPrompt: string;

	constructor(agent: Agent, systemPrompt: string) {
		this.agent = agent;
		this.systemPrompt = systemPrompt;
	}

	private async shouldHandle(request: Message): Promise<boolean> {
		const component = `agent:${this.agent.name}`;
		const allSkills = [
			...new Set(store.getAllAgents().flatMap((a) => a.skills)),
		];

		log.debug(component, "skill_eval_start", {
			requestPayload: request.payload.slice(0, 200),
			agentSkills: this.agent.skills,
			allSkills,
		});

		const completion = await client.messages.create({
			model: MODEL,
			max_tokens: 100,
			messages: [
				{
					role: "user",
					content: `Given this request: "${request.payload}"

Which of these skills are relevant? ${allSkills.join(", ")}

Reply with ONLY the relevant skill names, comma-separated. If none match, reply "none".`,
				},
			],
		});

		const responseText =
			completion.content[0].type === "text" ? completion.content[0].text : "";
		const neededSkills = responseText
			.toLowerCase()
			.split(",")
			.map((s) => s.trim())
			.filter((s) => allSkills.includes(s));

		if (neededSkills.length === 0) {
			log.debug(component, "skill_eval_result", {
				llmResponse: responseText,
				neededSkills: [],
				decision: "handle",
			});
			return true;
		}

		const matchingAgents = store.queryAgents(neededSkills);
		const shouldHandle = matchingAgents.some((a) => a.id === this.agent.id);

		log.debug(component, "skill_eval_result", {
			llmResponse: responseText,
			neededSkills,
			matchingAgentIds: matchingAgents.map((a) => a.id),
			decision: shouldHandle ? "handle" : "decline",
		});

		return shouldHandle;
	}

	// Delegation stub — extension point for spec's delegation/sub-request feature (TODO in spec)
	private async delegateIfNeeded(
		_request: Message,
	): Promise<AgentResult | null> {
		return null;
	}

	async handleRequest(request: Message): Promise<AgentResult | null> {
		const component = `agent:${this.agent.name}`;

		// Check if this agent has relevant skills for the request
		const relevant = await this.shouldHandle(request);
		if (!relevant) {
			log.info(component, "request_declined", {
				requestId: request.id,
				chainId: request.chainId,
				reason: "no matching skills",
			});
			return null;
		}

		// ACK
		store.storeMessage({
			chainId: request.chainId,
			replyTo: request.id,
			type: "ACK",
			payload: `${this.agent.name} acknowledged request`,
			from: this.agent.id,
			to: request.to,
		});
		log.info(component, "ack_sent", {
			chainId: request.chainId,
			requestId: request.id,
		});

		// PROCESS
		store.storeMessage({
			chainId: request.chainId,
			replyTo: request.id,
			type: "PROCESS",
			payload: `${this.agent.name} will process this request using skills: ${this.agent.skills.join(", ")}. Analyzing: "${request.payload.slice(0, 100)}"`,
			from: this.agent.id,
			to: request.to,
		});
		log.info(component, "process_sent", {
			chainId: request.chainId,
			requestId: request.id,
		});

		// Check if delegation can handle this request
		const delegated = await this.delegateIfNeeded(request);
		if (delegated) return delegated;

		// LLM call
		try {
			log.debug(component, "llm_call_start", {
				model: MODEL,
				requestPayload: request.payload,
			});
			const start = performance.now();
			const toonRequest = encodeMessage(request);
			const completion = await client.messages.create({
				model: MODEL,
				max_tokens: 1024,
				system: this.systemPrompt,
				messages: [{ role: "user", content: toonRequest }],
			});
			const durationMs = performance.now() - start;

			const responseText =
				completion.content[0].type === "text" ? completion.content[0].text : "";

			log.debug(component, "llm_call_complete", {
				model: MODEL,
				durationMs,
				usage: {
					inputTokens: completion.usage.input_tokens,
					outputTokens: completion.usage.output_tokens,
				},
				rawResponse: responseText,
			});

			// RESPONSE
			const response = store.storeMessage({
				chainId: request.chainId,
				replyTo: request.id,
				type: "RESPONSE",
				payload: responseText,
				from: this.agent.id,
				to: request.to,
			});
			log.info(component, "response_sent", {
				chainId: request.chainId,
				requestId: request.id,
				responseId: response.id,
				payloadLength: responseText.length,
			});

			return {
				agentName: this.agent.name,
				skills: this.agent.skills,
				response,
				usage: {
					inputTokens: completion.usage.input_tokens,
					outputTokens: completion.usage.output_tokens,
				},
				model: MODEL,
				durationMs,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			log.error(component, "llm_call_failed", {
				chainId: request.chainId,
				requestId: request.id,
				error: errorMessage,
			});

			// Fulfill ACK contract: MUST eventually send RESPONSE or error
			store.storeMessage({
				chainId: request.chainId,
				replyTo: request.id,
				type: "RESPONSE",
				payload: `Error: ${this.agent.name} failed to process request: ${errorMessage}`,
				from: this.agent.id,
				to: request.to,
			});

			return null;
		}
	}
}
