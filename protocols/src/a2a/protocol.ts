import type {
	Message as A2AMessage,
	Task as A2ATask,
	TextPart,
} from "@a2a-js/sdk";
import { type Client, ClientFactory } from "@a2a-js/sdk/client";
import type {
	AgentPersona,
	AgentResult,
	Protocol,
	ProtocolEventHandler,
	ProtocolInit,
	ProtocolResponse,
} from "core/types";
import { log } from "../logger.ts";
import type { A2AConfig } from "./types.ts";

type A2AResult = A2AMessage | A2ATask;

export class A2AProtocol implements Protocol {
	private readonly personas: AgentPersona[];
	private readonly config: A2AConfig;
	private readonly onEvent?: ProtocolEventHandler;
	private readonly clients = new Map<string, Client>();
	private readonly contextIds = new Map<string, string>();
	private healthChecked = false;

	constructor(
		personas: AgentPersona[],
		config: A2AConfig,
		onEvent?: ProtocolEventHandler,
	) {
		this.personas = personas;
		this.config = config;
		this.onEvent = onEvent;
	}

	initialize(userName: string): ProtocolInit {
		return {
			userId: userName,
			userName,
			agents: this.personas.map((p) => ({
				name: p.name,
				skills: p.skills,
			})),
		};
	}

	async sendRequest(
		userId: string,
		message: string,
		chainId?: string,
	): Promise<ProtocolResponse> {
		await this.ensureHealthy();

		const results = await Promise.all(
			this.personas.map(async (persona): Promise<AgentResult> => {
				log.info("a2a", "agent_start", {
					agent: persona.name,
					skills: persona.skills,
				});
				this.onEvent?.({
					agentName: persona.name,
					type: "state_change",
					detail: `sending via A2A: [${persona.skills.join(", ")}]`,
				});

				const client = await this.getOrCreateClient(persona.name);
				const contextId = chainId ?? this.contextIds.get(persona.name);

				const start = performance.now();
				let result: A2AResult;
				try {
					result = await client.sendMessage({
						message: {
							messageId: crypto.randomUUID(),
							role: "user",
							kind: "message",
							parts: [{ kind: "text", text: message }],
							...(contextId ? { contextId } : {}),
						},
					});
				} catch (err) {
					const durationMs = performance.now() - start;
					const errorMsg = err instanceof Error ? err.message : String(err);
					log.error("a2a", "agent_error", {
						agent: persona.name,
						error: errorMsg,
					});
					this.onEvent?.({
						agentName: persona.name,
						type: "error",
						detail: errorMsg,
					});
					return this.errorResult(persona, userId, errorMsg, durationMs);
				}
				const durationMs = performance.now() - start;

				const { text, newContextId, metadata } = this.extractFromResult(result);

				if (newContextId) {
					this.contextIds.set(persona.name, newContextId);
				}

				log.info("a2a", "agent_complete", {
					agent: persona.name,
					inputTokens: metadata.usage?.input_tokens,
					outputTokens: metadata.usage?.output_tokens,
					durationMs: Math.round(durationMs),
				});

				return {
					agentName: persona.name,
					skills: persona.skills,
					response: {
						id: crypto.randomUUID(),
						chainId: newContextId ?? chainId ?? crypto.randomUUID(),
						replyTo: undefined,
						timestamp: new Date().toISOString(),
						type: "RESPONSE",
						payload: text,
						from: persona.name.toLowerCase(),
						to: [userId],
					},
					usage: metadata.usage
						? {
								inputTokens: metadata.usage.input_tokens,
								outputTokens: metadata.usage.output_tokens,
							}
						: undefined,
					model: metadata.model ?? undefined,
					durationMs: metadata.duration_ms ?? durationMs,
				};
			}),
		);

		return { results };
	}

	private async getOrCreateClient(personaName: string): Promise<Client> {
		let client = this.clients.get(personaName);
		if (!client) {
			const url = this.config.agentUrls[personaName];
			if (!url) {
				throw new Error(
					`No A2A URL configured for agent "${personaName}". ` +
						"Configure via A2A_*_URL env vars.",
				);
			}
			const factory = new ClientFactory();
			client = await factory.createFromUrl(url);
			this.clients.set(personaName, client);
		}
		return client;
	}

	private extractFromResult(result: A2AResult): {
		text: string;
		newContextId: string | undefined;
		metadata: {
			usage?: { input_tokens: number; output_tokens: number };
			model?: string;
			duration_ms?: number;
		};
	} {
		if (result.kind === "message") {
			const msg = result as A2AMessage;
			return {
				text: this.extractTextFromParts(msg.parts),
				newContextId: msg.contextId,
				metadata: this.extractMetadata(msg.metadata),
			};
		}

		// Task response — text can be in artifacts, status.message, or history
		const task = result as A2ATask;
		const artifactText = this.extractTextFromParts(
			task.artifacts?.[0]?.parts ?? [],
		);
		const statusText = task.status?.message
			? this.extractTextFromParts(task.status.message.parts)
			: "";
		const text = artifactText || statusText;

		return {
			text: text || "(no response)",
			newContextId: task.contextId,
			metadata: this.extractMetadata(task.metadata),
		};
	}

	private extractTextFromParts(parts: unknown[]): string {
		return parts
			.filter(
				(p): p is TextPart =>
					typeof p === "object" &&
					p !== null &&
					"kind" in p &&
					(p as TextPart).kind === "text",
			)
			.map((p) => p.text)
			.join("\n");
	}

	private extractMetadata(metadata?: Record<string, unknown>): {
		usage?: { input_tokens: number; output_tokens: number };
		model?: string;
		duration_ms?: number;
	} {
		if (!metadata) return {};
		return {
			usage: metadata.usage as
				| { input_tokens: number; output_tokens: number }
				| undefined,
			model: metadata.model as string | undefined,
			duration_ms: metadata.duration_ms as number | undefined,
		};
	}

	private errorResult(
		persona: AgentPersona,
		userId: string,
		error: string,
		durationMs: number,
	): AgentResult {
		return {
			agentName: persona.name,
			skills: persona.skills,
			response: {
				id: crypto.randomUUID(),
				chainId: crypto.randomUUID(),
				replyTo: undefined,
				timestamp: new Date().toISOString(),
				type: "ERROR",
				payload: error,
				from: persona.name.toLowerCase(),
				to: [userId],
			},
			durationMs,
		};
	}

	private async ensureHealthy(): Promise<void> {
		if (this.healthChecked) return;
		this.healthChecked = true;

		const unreachable: string[] = [];
		await Promise.all(
			this.personas.map(async (persona) => {
				const url = this.config.agentUrls[persona.name];
				if (!url) {
					unreachable.push(persona.name);
					return;
				}
				try {
					const client = await this.getOrCreateClient(persona.name);
					await client.getAgentCard();
				} catch {
					unreachable.push(persona.name);
				}
			}),
		);

		if (unreachable.length === this.personas.length) {
			throw new Error(
				`No A2A agents reachable. Tried: ${Object.entries(this.config.agentUrls)
					.map(([name, url]) => `${name} at ${url}`)
					.join(", ")}. ` +
					"Start the agent servers: see external/a2a/README.md",
			);
		}

		if (unreachable.length > 0) {
			log.warn("a2a", "agents_unreachable", { agents: unreachable });
		}
	}
}
