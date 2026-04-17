import type Anthropic from "@anthropic-ai/sdk";
import {
	client,
	MAX_AGENT_ITERATIONS,
	MAX_OUTPUT_TOKENS,
	MAX_VALIDATION_RETRIES,
	MODEL,
} from "core/config";

const MAX_LLM_VALIDATION_FAILURES = MAX_VALIDATION_RETRIES;

import type { ProtocolEventHandler } from "core/types";
import { log } from "../logger.ts";
import { assembleSystemPrompt } from "./prompt.ts";
import { STORE_SENDER, type StoreParley } from "./store.ts";
import { createToolDefinitions } from "./tool-definitions.ts";
import { executeToolCall } from "./tool-executor.ts";
import { encodeOutboundParley } from "./toon.ts";
import type { AgentMeta, AgentParley, MessageParley } from "./types.ts";

interface AgentConfig {
	agent: AgentParley;
	systemPrompt: string;
	customInstructions?: string;
	customTools?: Anthropic.Messages.Tool[];
	onMeta?: (chainId: string, meta: AgentMeta) => void;
	onEvent?: ProtocolEventHandler;
	onDecline?: (chainId: string) => void;
}

export class ProtocolAgentParley {
	readonly agent: AgentParley;
	private readonly store: StoreParley;
	private readonly systemPrompt: string;
	private readonly tools: Anthropic.Messages.Tool[];
	private readonly onMeta?: (chainId: string, meta: AgentMeta) => void;
	private readonly onEvent?: ProtocolEventHandler;
	private readonly onDecline?: (chainId: string) => void;
	private readonly chainHistory: Map<
		string,
		Anthropic.Messages.MessageParam[]
	> = new Map();
	// parent chainId -> set of sub-chainIds this agent spawned while processing it
	private readonly subChains: Map<string, Set<string>> = new Map();

	constructor(store: StoreParley, config: AgentConfig) {
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
		this.store.subscribe(
			this.agent.id,
			(_toon: string, message: MessageParley) => this.onMessage(message),
		);
		log.info(`agent_parley:${this.agent.name}`, "subscribed", {
			agentId: this.agent.id,
		});
	}

	stop(): void {
		this.store.unsubscribe(this.agent.id);
	}

	private async onMessage(message: MessageParley): Promise<void> {
		const component = `agent_parley:${this.agent.name}`;

		// Store-synthesized CLAIM-rejection ERROR (spec §CLAIM step 7):
		// `from: "store"`, `replyTo` points at this agent's CLAIM id.
		// Receipt is terminal — do NOT ACK, clean up state.
		if (message.type === "ERROR" && message.from === STORE_SENDER) {
			const hadState =
				this.chainHistory.has(message.chainId) ||
				this.subChains.has(message.chainId);
			if (!hadState) return;
			log.info(component, "claim_rejected_received", {
				chainId: message.chainId,
				replyTo: message.replyTo,
				payload: message.payload,
			});
			this.propagateCancelToSubChains(component, message.chainId);
			this.chainHistory.delete(message.chainId);
			this.subChains.delete(message.chainId);
			this.store.updateAgentStatus(this.agent.id, "idle");
			return;
		}

		// Only react to REQUEST and CANCEL
		if (message.type !== "REQUEST" && message.type !== "CANCEL") return;

		if (message.type === "CANCEL") {
			// Propagate CANCEL to any sub-chains this agent spawned while
			// processing the parent chain (spec §CANCEL).
			this.propagateCancelToSubChains(component, message.chainId);

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
			this.subChains.delete(message.chainId);
			this.store.updateAgentStatus(this.agent.id, "idle");
			return;
		}

		// REQUEST: agent-side TTL pre-check (spec §Headers `ttl`).
		// The store accepts expired REQUESTs; the agent is the gatekeeper.
		const ttl = message.headers?.ttl;
		if (ttl && new Date() > new Date(ttl)) {
			log.info(component, "ttl_expired_pre_start", {
				chainId: message.chainId,
				requestId: message.id,
				ttl,
			});
			this.safeStoreMessage(component, {
				chainId: message.chainId,
				replyTo: message.id,
				type: "ERROR",
				payload: `TTL expired at ${ttl}; refusing to start work`,
				from: this.agent.id,
				to: [message.from],
			});
			return;
		}

		// REQUEST: run the agentic loop
		this.store.updateAgentStatus(this.agent.id, "working");

		const history = this.chainHistory.get(message.chainId) ?? [];
		const isDirectRequest = message.to.includes(this.agent.id);

		// For direct requests (addressed to this agent by ID), auto-ACK
		if (isDirectRequest) {
			this.safeStoreMessage(component, {
				chainId: message.chainId,
				replyTo: message.id,
				type: "ACK",
				payload: `${this.agent.name} accepting direct request`,
				headers: { accept: "true" },
				from: this.agent.id,
				to: message.to,
			});
			this.onEvent?.({
				agentName: this.agent.name,
				type: "state_change",
				detail: "ACK sent",
			});
			log.info(component, "auto_ack_direct", {
				chainId: message.chainId,
				requestId: message.id,
			});
		}

		// Build the user message for the LLM
		const messageFields = `id: ${message.id}\nversion: ${message.version}\nchainId: ${message.chainId}\nsequence: ${message.sequence}\nreplyTo: ${message.replyTo ?? "undefined"}\ntimestamp: ${message.timestamp}\ntype: ${message.type}\npayload: ${message.payload}\nheaders: ${JSON.stringify(message.headers)}\nfrom: ${message.from}\nto: ${message.to.join(", ")}`;

		let userContent: string;
		if (isDirectRequest) {
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
		let storeValidationFailures = 0;
		let validationExhausted = false;
		const startTime = performance.now();

		for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
			// Agent-side mid-loop TTL re-check (spec §Headers `ttl`).
			if (ttl && new Date() > new Date(ttl)) {
				log.info(component, "ttl_expired_mid_process", {
					chainId: message.chainId,
					requestId: message.id,
					iteration,
					ttl,
				});
				this.safeStoreMessage(component, {
					chainId: message.chainId,
					replyTo: message.id,
					type: "ERROR",
					payload: `TTL expired at ${ttl} during PROCESS; aborting work`,
					from: this.agent.id,
					to: [message.from],
				});
				this.propagateCancelToSubChains(component, message.chainId);
				break;
			}

			const response = await client.messages.create({
				model: MODEL,
				max_tokens: MAX_OUTPUT_TOKENS,
				system: [
					{
						type: "text",
						text: this.systemPrompt,
						cache_control: { type: "ephemeral" },
					},
				],
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
					const stored = result.data as {
						type?: string;
						chainId?: string;
					};
					const msgType = stored.type;
					if (msgType) {
						this.onEvent?.({
							agentName: this.agent.name,
							type: "state_change",
							detail: `${msgType} sent`,
						});
						if (msgType === "RESPONSE") sentResponse = true;
					}
					// Track sub-chains: a REQUEST on a chainId different from the
					// parent chain is a sub-REQUEST this agent spawned from PROCESS.
					if (
						msgType === "REQUEST" &&
						stored.chainId &&
						stored.chainId !== message.chainId
					) {
						let set = this.subChains.get(message.chainId);
						if (!set) {
							set = new Set<string>();
							this.subChains.set(message.chainId, set);
						}
						set.add(stored.chainId);
					}
				}

				// Log store_message failures — the error result gets fed back
				// to the LLM so it can retry on the next iteration. Per spec
				// §Validation, after 3 cumulative failures in this handling
				// session, emit an ERROR on the agent's behalf and stop.
				if (block.name === "store_message") {
					if (result.success) {
						storeValidationFailures = 0;
					} else {
						storeValidationFailures += 1;
						log.warn(component, "store_message_failed", {
							chainId: message.chainId,
							error: result.error,
							attempt: storeValidationFailures,
						});
						if (storeValidationFailures >= MAX_LLM_VALIDATION_FAILURES) {
							validationExhausted = true;
						}
					}
				}

				toolResults.push({
					type: "tool_result",
					tool_use_id: block.id,
					content: JSON.stringify(result),
				});
			}

			history.push({ role: "user", content: toolResults });

			if (validationExhausted) {
				log.error(component, "llm_validation_exhausted", {
					chainId: message.chainId,
					requestId: message.id,
					failures: storeValidationFailures,
				});
				this.safeStoreMessage(component, {
					chainId: message.chainId,
					replyTo: message.id,
					type: "ERROR",
					payload: "Agent failed to validate message after 3 attempts.",
					from: this.agent.id,
					to: [message.from],
				});
				this.propagateCancelToSubChains(component, message.chainId);
				break;
			}

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

		this.chainHistory.set(message.chainId, history);
		this.store.updateAgentStatus(this.agent.id, "idle");

		log.info(component, "agentic_loop_complete", {
			chainId: message.chainId,
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			durationMs,
		});
	}

	private propagateCancelToSubChains(
		component: string,
		parentChainId: string,
	): void {
		const subs = this.subChains.get(parentChainId);
		if (!subs || subs.size === 0) return;

		for (const subChainId of subs) {
			const originRequests = this.store.getMessage({
				chainId: subChainId,
				type: "REQUEST",
			});
			const origin = originRequests.find((m) => !m.replyTo);
			if (!origin) {
				log.warn(component, "subchain_cancel_no_origin", {
					parentChainId,
					subChainId,
				});
				continue;
			}
			this.safeStoreMessage(component, {
				chainId: subChainId,
				replyTo: origin.id,
				type: "CANCEL",
				payload: `Parent chain ${parentChainId} cancelled`,
				from: this.agent.id,
				to: origin.to,
			});
			log.info(component, "subchain_cancel_propagated", {
				parentChainId,
				subChainId,
			});
		}
		this.subChains.delete(parentChainId);
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
	): MessageParley | undefined {
		for (let attempt = 0; attempt < MAX_VALIDATION_RETRIES; attempt++) {
			try {
				return this.store.storeMessage(
					encodeOutboundParley({
						chainId: fields.chainId,
						replyTo: fields.replyTo,
						type: fields.type as MessageParley["type"],
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

		// Spec §Error Handling: after 3 failed validation attempts, emit ERROR.
		// Skip if the exhausted message was itself an ERROR (don't recurse).
		if (fields.type !== "ERROR") {
			try {
				const origin = this.store
					.getMessage({ chainId: fields.chainId, type: "REQUEST" })
					.find((m) => !m.replyTo);
				const errorTo = origin ? [origin.from] : fields.to;
				this.store.storeMessage(
					encodeOutboundParley({
						chainId: fields.chainId,
						replyTo: fields.replyTo,
						type: "ERROR",
						payload: "Agent failed to validate message after 3 attempts.",
						from: fields.from,
						to: errorTo,
					}),
				);
			} catch (errError: unknown) {
				const msg =
					errError instanceof Error ? errError.message : String(errError);
				log.error(component, "safe_store_exhausted_error_failed", {
					chainId: fields.chainId,
					error: msg,
				});
			}
		}

		return undefined;
	}
}
