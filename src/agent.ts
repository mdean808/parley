import Anthropic from "@anthropic-ai/sdk";
import { log } from "./logger.ts";
import { store } from "./store.ts";
import { encodeOutbound } from "./toon.ts";
import type { Agent, Message } from "./types.ts";

const MODEL: string = process.env.MODEL || "claude-haiku-4-5-20251001";
const client: Anthropic = new Anthropic();

/**
 * An event-driven protocol agent that subscribes to the store, evaluates
 * incoming REQUESTs against its skills via an LLM call, and follows the
 * ACK → PROCESS → RESPONSE state machine for relevant requests.
 */
export class ProtocolAgent {
	readonly agent: Agent;
	readonly systemPrompt: string;

	constructor(agent: Agent, systemPrompt: string) {
		this.agent = agent;
		this.systemPrompt = systemPrompt;
	}

	/** Subscribes this agent to the store to begin receiving messages. */
	start(): void {
		store.subscribe(this.agent.id, (toonMessage: string, message: Message) =>
			this.onMessage(toonMessage, message),
		);
		log.info(`agent:${this.agent.name}`, "subscribed", {
			agentId: this.agent.id,
		});
	}

	/** Unsubscribes this agent from the store, stopping message delivery. */
	stop(): void {
		store.unsubscribe(this.agent.id);
		log.info(`agent:${this.agent.name}`, "unsubscribed", {
			agentId: this.agent.id,
		});
	}

	/**
	 * Handles an incoming message from the store. Ignores non-REQUEST messages.
	 * For REQUESTs, evaluates skill relevance, then sends ACK → PROCESS → RESPONSE
	 * via `store.sendMessage()`. Stores LLM metadata on the RESPONSE.
	 * If the LLM call fails after ACK, still sends an error RESPONSE to fulfill the ACK contract.
	 * @param toonMessage - The TOON-encoded message string (passed to the LLM).
	 * @param message - The decoded Message object.
	 */
	private async onMessage(
		toonMessage: string,
		message: Message,
	): Promise<void> {
		if (message.type !== "REQUEST") return;

		const component: string = `agent:${this.agent.name}`;

		const relevant: boolean = await this.shouldHandle(message);
		if (!relevant) {
			log.info(component, "request_declined", {
				requestId: message.id,
				chainId: message.chainId,
				reason: "no matching skills",
			});
			return;
		}

		// ACK
		store.sendMessage(
			encodeOutbound({
				chainId: message.chainId,
				replyTo: message.id,
				type: "ACK",
				payload: `${this.agent.name} acknowledged request`,
				from: this.agent.id,
				to: [message.from],
			}),
		);
		log.info(component, "ack_sent", {
			chainId: message.chainId,
			requestId: message.id,
		});

		// PROCESS
		store.sendMessage(
			encodeOutbound({
				chainId: message.chainId,
				replyTo: message.id,
				type: "PROCESS",
				payload: `${this.agent.name} will process this request using skills: ${this.agent.skills.join(", ")}. Analyzing: "${message.payload.slice(0, 100)}"`,
				from: this.agent.id,
				to: [message.from],
			}),
		);
		log.info(component, "process_sent", {
			chainId: message.chainId,
			requestId: message.id,
		});

		// LLM call
		try {
			log.debug(component, "llm_call_start", {
				model: MODEL,
				requestPayload: message.payload,
			});
			const start: number = performance.now();
			const completion = await client.messages.create({
				model: MODEL,
				max_tokens: 1024,
				system: this.systemPrompt,
				messages: [{ role: "user", content: toonMessage }],
			});
			const durationMs: number = performance.now() - start;

			const responseText: string =
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
			const response: Message = store.sendMessage(
				encodeOutbound({
					chainId: message.chainId,
					replyTo: message.id,
					type: "RESPONSE",
					payload: responseText,
					from: this.agent.id,
					to: [message.from],
				}),
			);
			log.info(component, "response_sent", {
				chainId: message.chainId,
				requestId: message.id,
				responseId: response.id,
				payloadLength: responseText.length,
			});

			store.setMessageMeta(response.id, {
				usage: {
					inputTokens: completion.usage.input_tokens,
					outputTokens: completion.usage.output_tokens,
				},
				model: MODEL,
				durationMs,
			});
		} catch (error: unknown) {
			const errorMessage: string =
				error instanceof Error ? error.message : String(error);
			log.error(component, "llm_call_failed", {
				chainId: message.chainId,
				requestId: message.id,
				error: errorMessage,
			});

			// Fulfill ACK contract: MUST eventually send RESPONSE or error
			store.sendMessage(
				encodeOutbound({
					chainId: message.chainId,
					replyTo: message.id,
					type: "RESPONSE",
					payload: `Error: ${this.agent.name} failed to process request: ${errorMessage}`,
					from: this.agent.id,
					to: [message.from],
				}),
			);
		}
	}

	/**
	 * Uses an LLM call to determine which skills from across all agents are relevant
	 * to the request, then checks whether this agent holds any of those skills.
	 * Returns true if no skills are identified (fallback: handle everything).
	 * @param request - The incoming REQUEST message to evaluate.
	 * @returns Whether this agent should handle the request.
	 */
	private async shouldHandle(request: Message): Promise<boolean> {
		const component: string = `agent:${this.agent.name}`;
		const allSkills: string[] = [
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

		const responseText: string =
			completion.content[0].type === "text" ? completion.content[0].text : "";
		const neededSkills: string[] = responseText
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

		const matchingAgents: Agent[] = store.queryAgents(neededSkills);
		const shouldHandle: boolean = matchingAgents.some(
			(a) => a.id === this.agent.id,
		);

		log.debug(component, "skill_eval_result", {
			llmResponse: responseText,
			neededSkills,
			matchingAgentIds: matchingAgents.map((a) => a.id),
			decision: shouldHandle ? "handle" : "decline",
		});

		return shouldHandle;
	}
}
