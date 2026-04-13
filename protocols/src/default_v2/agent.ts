import type Anthropic from "@anthropic-ai/sdk";
import {
	client,
	MAX_AGENT_ITERATIONS,
	MAX_VALIDATION_RETRIES,
	MODEL,
} from "core/config";
import type { ProtocolEventHandler } from "core/types";
import { log } from "../logger.ts";
import { assembleSystemPrompt } from "./prompt.ts";
import type { StoreV2 } from "./store.ts";
import { createToolDefinitions } from "./tool-definitions.ts";
import { executeToolCall } from "./tool-executor.ts";
import { encodeOutboundV2 } from "./toon.ts";
import type { AgentMeta, AgentV2, MessageV2 } from "./types.ts";

interface AgentConfig {
	agent: AgentV2;
	systemPrompt: string;
	customInstructions?: string;
	customTools?: Anthropic.Messages.Tool[];
	onMeta?: (chainId: string, meta: AgentMeta) => void;
	onEvent?: ProtocolEventHandler;
	onDecline?: (chainId: string) => void;
}

export class ProtocolAgentV2 {
	readonly agent: AgentV2;
	private readonly store: StoreV2;
	private readonly systemPrompt: string;
	private readonly tools: Anthropic.Messages.Tool[];
	private readonly onMeta?: (chainId: string, meta: AgentMeta) => void;
	private readonly onEvent?: ProtocolEventHandler;
	private readonly onDecline?: (chainId: string) => void;
	private readonly chainHistory: Map<
		string,
		Anthropic.Messages.MessageParam[]
	> = new Map();
	private readonly chainResponded: Set<string> = new Set();

	constructor(store: StoreV2, config: AgentConfig) {
		this.agent = config.agent;
		this.store = store;
		this.onEvent = config.onEvent;
		this.systemPrompt = assembleSystemPrompt({
			agentName: config.agent.name,
			agentId: config.agent.id,
			agentSkills: config.agent.skills,
			customInstructions: config.customInstructions,
			customTools: config.customTools
				?.map((t) => `- \`${t.name}\` — ${t.description}`)
				.join("\n"),
		});
		this.tools = createToolDefinitions(config.customTools);
		this.onMeta = config.onMeta;
		this.onDecline = config.onDecline;
	}

	start(): void {
		this.store.subscribe(this.agent.id, (_toon: string, message: MessageV2) =>
			this.onMessage(message),
		);
		log.info(`agent_v2:${this.agent.name}`, "subscribed", {
			agentId: this.agent.id,
		});
	}

	stop(): void {
		this.store.unsubscribe(this.agent.id);
	}

	private async onMessage(message: MessageV2): Promise<void> {
		// Only react to REQUEST and CANCEL
		if (message.type !== "REQUEST" && message.type !== "CANCEL") return;

		const component = `agent_v2:${this.agent.name}`;

		if (message.type === "CANCEL") {
			// ACK the cancel
			this.safeStoreMessage(component, {
				chainId: message.chainId,
				replyTo: message.id,
				type: "ACK",
				payload: `${this.agent.name} acknowledged cancellation`,
				from: this.agent.id,
				to: message.to,
			});
			this.chainHistory.delete(message.chainId);
			this.chainResponded.delete(message.chainId);
			this.store.updateAgentStatus(this.agent.id, "idle");
			return;
		}

		// REQUEST: run the agentic loop
		this.store.updateAgentStatus(this.agent.id, "working");

		const history = this.chainHistory.get(message.chainId) ?? [];
		const hasRespondedOnChain = this.chainResponded.has(message.chainId);
		const isDirectRequest = message.to.includes(this.agent.id);

		// For follow-up requests on chains we already responded to,
		// send ACK immediately (bypass LLM) so it arrives within the ACK window
		if (hasRespondedOnChain) {
			this.safeStoreMessage(component, {
				chainId: message.chainId,
				replyTo: message.id,
				type: "ACK",
				payload: `${this.agent.name} continuing chain`,
				headers: { accept: "true" },
				from: this.agent.id,
				to: message.to,
			});
			log.info(component, "auto_ack_followup", {
				chainId: message.chainId,
				requestId: message.id,
			});
		}

		// For direct requests (addressed to this agent by ID), auto-ACK
		if (!hasRespondedOnChain && isDirectRequest) {
			this.safeStoreMessage(component, {
				chainId: message.chainId,
				replyTo: message.id,
				type: "ACK",
				payload: `${this.agent.name} accepting direct request`,
				headers: { accept: "true" },
				from: this.agent.id,
				to: message.to,
			});
			log.info(component, "auto_ack_direct", {
				chainId: message.chainId,
				requestId: message.id,
			});
		}

		// Build the user message for the LLM
		const messageFields = `id: ${message.id}\nversion: ${message.version}\nchainId: ${message.chainId}\nsequence: ${message.sequence}\nreplyTo: ${message.replyTo ?? "undefined"}\ntimestamp: ${message.timestamp}\ntype: ${message.type}\npayload: ${message.payload}\nheaders: ${JSON.stringify(message.headers)}\nfrom: ${message.from}\nto: ${message.to.join(", ")}`;

		let userContent: string;
		if (hasRespondedOnChain) {
			// Already responded on this chain — skip skill evaluation and ACK (already sent)
			userContent = `This is a FOLLOW-UP on a chain you already responded to. ACK has already been sent on your behalf.\n\nNew REQUEST:\n\n${messageFields}\n\nProceed directly: send PROCESS, then RESPONSE. Set replyTo to "${message.id}" on all messages you send.`;
		} else if (isDirectRequest) {
			// Direct request addressed to this agent by ID — always accept, skip skill evaluation
			userContent = `You received a DIRECT REQUEST addressed specifically to you by another agent. ACK with accept: true has already been sent on your behalf.\n\nREQUEST:\n\n${messageFields}\n\nThis request was sent directly to you — do your best to fulfill it regardless of skill match. Proceed directly: send PROCESS, then RESPONSE. Set replyTo to "${message.id}" on all messages you send.`;
		} else {
			// Broadcast request — evaluate skills
			userContent = `You received a new REQUEST message:\n\n${messageFields}\n\nEvaluate this request against your skills. You MUST send an ACK:\n- If it matches your skills: send ACK with header \`accept: true\`, then PROCESS, then RESPONSE.\n- If it does not match: send ACK with header \`accept: false\` and a one-sentence reason in the payload. Then stop.\n\nSet replyTo to "${message.id}" on all messages you send.`;
		}

		history.push({ role: "user", content: userContent });

		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let sentResponse = false;
		const startTime = performance.now();

		for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
			const response = await client.messages.create({
				model: MODEL,
				max_tokens: 2048,
				system: this.systemPrompt,
				tools: this.tools,
				messages: history,
			});

			totalInputTokens += response.usage.input_tokens;
			totalOutputTokens += response.usage.output_tokens;

			// Build the assistant message content
			const assistantContent: Anthropic.Messages.ContentBlock[] =
				response.content;

			history.push({ role: "assistant", content: assistantContent });

			// Text-only response with no tool calls = agent is done
			const textBlocks = assistantContent.filter((b) => b.type === "text");
			if (
				response.stop_reason === "end_turn" &&
				assistantContent.every((b) => b.type === "text")
			) {
				if (!sentResponse) {
					const text = textBlocks.map((b) => b.text).join("");
					log.info(component, "request_declined", {
						chainId: message.chainId,
						requestId: message.id,
					});
					this.onEvent?.({
						agentName: this.agent.name,
						type: "decline",
						detail: text.trim() || "silent decline",
					});
				}
				break;
			}

			// Process tool calls
			const toolUseBlocks = assistantContent.filter(
				(b) => b.type === "tool_use",
			);

			if (toolUseBlocks.length === 0) {
				// No tool calls, LLM is done
				break;
			}

			// Execute each tool call and collect results
			const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

			for (const block of toolUseBlocks) {
				if (block.type !== "tool_use") continue;

				this.onEvent?.({
					agentName: this.agent.name,
					type: "tool_use",
					detail: `${block.name}(${JSON.stringify(block.input).slice(0, 100)})`,
				});

				const result = executeToolCall(
					block.name,
					block.input as Record<string, unknown>,
					this.store,
					this.agent.id,
				);

				// Emit events for store_message tool calls
				if (block.name === "store_message" && result.success && result.data) {
					const msgType = (result.data as { type?: string }).type;
					if (msgType) {
						this.onEvent?.({
							agentName: this.agent.name,
							type: "state_change",
							detail: `${msgType} sent`,
						});
						if (msgType === "RESPONSE") sentResponse = true;
					}
				}

				// Log store_message failures — the error result gets fed back
				// to the LLM so it can retry on the next iteration
				if (block.name === "store_message" && !result.success) {
					log.warn(component, "store_message_failed", {
						chainId: message.chainId,
						error: result.error,
					});
				}

				toolResults.push({
					type: "tool_result",
					tool_use_id: block.id,
					content: JSON.stringify(result),
				});
			}

			history.push({ role: "user", content: toolResults });

			// Update meta incrementally so it's available before the next await
			if (this.onMeta) {
				this.onMeta(message.chainId, {
					usage: {
						inputTokens: totalInputTokens,
						outputTokens: totalOutputTokens,
					},
					model: MODEL,
					durationMs: performance.now() - startTime,
				});
			}

			if (response.stop_reason === "end_turn") {
				break;
			}
		}

		if (!sentResponse) {
			log.info(component, "request_not_handled", {
				chainId: message.chainId,
				requestId: message.id,
			});
			this.onDecline?.(message.chainId);
		}

		const durationMs = performance.now() - startTime;

		if (this.onMeta) {
			this.onMeta(message.chainId, {
				usage: {
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
				},
				model: MODEL,
				durationMs,
			});
		}

		if (sentResponse) {
			this.chainResponded.add(message.chainId);
		}
		this.chainHistory.set(message.chainId, history);
		this.store.updateAgentStatus(this.agent.id, "idle");

		log.info(component, "agentic_loop_complete", {
			chainId: message.chainId,
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			durationMs,
		});
	}

	private safeStoreMessage(
		component: string,
		fields: {
			chainId: string;
			replyTo: string | undefined;
			type: string;
			payload: string;
			from: string;
			to: string[];
			headers?: Record<string, string>;
		},
	): MessageV2 | undefined {
		for (let attempt = 0; attempt < MAX_VALIDATION_RETRIES; attempt++) {
			try {
				return this.store.storeMessage(
					encodeOutboundV2({
						chainId: fields.chainId,
						replyTo: fields.replyTo,
						type: fields.type as MessageV2["type"],
						payload: fields.payload,
						headers: fields.headers,
						from: fields.from,
						to: fields.to,
					}),
				);
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				log.warn(component, "safe_store_failed", {
					attempt: attempt + 1,
					error: msg,
				});
			}
		}
		log.error(component, "safe_store_exhausted", {
			chainId: fields.chainId,
			type: fields.type,
		});
		return undefined;
	}
}
