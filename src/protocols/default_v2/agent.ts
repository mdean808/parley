import type Anthropic from "@anthropic-ai/sdk";
import { client, MODEL } from "../../config.ts";
import { log } from "../../logger.ts";
import type { ProtocolEventHandler } from "../../types.ts";
import { assembleSystemPrompt } from "./prompt.ts";
import type { StoreV2 } from "./store.ts";
import { createToolDefinitions, executeToolCall } from "./tools.ts";
import { encodeOutboundV2 } from "./toon.ts";
import type { AgentMeta, AgentV2, MessageV2 } from "./types.ts";

const MAX_ITERATIONS = 15;
const MAX_VALIDATION_RETRIES = 3;

interface AgentConfig {
	agent: AgentV2;
	systemPrompt: string;
	customInstructions?: string;
	customTools?: Anthropic.Messages.Tool[];
	onMeta?: (chainId: string, meta: AgentMeta) => void;
	onEvent?: ProtocolEventHandler;
}

export class ProtocolAgentV2 {
	readonly agent: AgentV2;
	private readonly store: StoreV2;
	private readonly systemPrompt: string;
	private readonly tools: Anthropic.Messages.Tool[];
	private readonly onMeta?: (chainId: string, meta: AgentMeta) => void;
	private readonly onEvent?: ProtocolEventHandler;
	private readonly chainHistory: Map<
		string,
		Anthropic.Messages.MessageParam[]
	> = new Map();

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
			this.store.updateAgentStatus(this.agent.id, "idle");
			return;
		}

		// REQUEST: run the agentic loop
		this.store.updateAgentStatus(this.agent.id, "working");

		const history = this.chainHistory.get(message.chainId) ?? [];

		// Present the incoming request to the LLM
		history.push({
			role: "user",
			content: `You received a new REQUEST message:\n\nid: ${message.id}\nversion: ${message.version}\nchainId: ${message.chainId}\nsequence: ${message.sequence}\nreplyTo: ${message.replyTo ?? "undefined"}\ntimestamp: ${message.timestamp}\ntype: ${message.type}\npayload: ${message.payload}\nheaders: ${JSON.stringify(message.headers)}\nfrom: ${message.from}\nto: ${message.to.join(", ")}\n\nFollow the protocol: ACK if relevant to your skills, then PROCESS, then RESPONSE. If this request doesn't match your skills, do nothing (respond with a single text message saying "SKIP").`,
		});

		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		const startTime = performance.now();

		for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
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

			// Check for text-only response indicating SKIP
			const textBlocks = assistantContent.filter((b) => b.type === "text");
			if (
				response.stop_reason === "end_turn" &&
				textBlocks.length > 0 &&
				assistantContent.every((b) => b.type === "text")
			) {
				const text = textBlocks.map((b) => b.text).join("");
				if (text.trim().toUpperCase().includes("SKIP")) {
					log.info(component, "request_declined", {
						chainId: message.chainId,
						requestId: message.id,
					});
					this.onEvent?.({
						agentName: this.agent.name,
						type: "decline",
						detail: `SKIP — ${text.trim()}`,
					});
					break;
				}
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

			if (response.stop_reason === "end_turn") {
				break;
			}
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
