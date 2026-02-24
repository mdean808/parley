import Anthropic from "@anthropic-ai/sdk";
import { log } from "./logger.ts";
import { store } from "./store.ts";
import { encodeOutbound } from "./toon.ts";
import type { Agent, Message } from "./types.ts";

const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const client = new Anthropic();

export class ProtocolAgent {
	agent: Agent;
	systemPrompt: string;

	constructor(agent: Agent, systemPrompt: string) {
		this.agent = agent;
		this.systemPrompt = systemPrompt;
	}

	start(): void {
		store.subscribe(this.agent.id, (toonMessage, message) =>
			this.onMessage(toonMessage, message),
		);
		log.info(`agent:${this.agent.name}`, "subscribed", {
			agentId: this.agent.id,
		});
	}

	stop(): void {
		store.unsubscribe(this.agent.id);
		log.info(`agent:${this.agent.name}`, "unsubscribed", {
			agentId: this.agent.id,
		});
	}

	private async onMessage(
		toonMessage: string,
		message: Message,
	): Promise<void> {
		if (message.type !== "REQUEST") return;

		const component = `agent:${this.agent.name}`;

		const relevant = await this.shouldHandle(message);
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
			const start = performance.now();
			const completion = await client.messages.create({
				model: MODEL,
				max_tokens: 1024,
				system: this.systemPrompt,
				messages: [{ role: "user", content: toonMessage }],
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
			const response = store.sendMessage(
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
		} catch (error) {
			const errorMessage =
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
}
