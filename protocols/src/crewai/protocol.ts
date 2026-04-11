import type {
	AgentPersona,
	AgentResult,
	Protocol,
	ProtocolEventHandler,
	ProtocolInit,
	ProtocolResponse,
} from "core/types";
import { log } from "../logger.ts";
import type {
	CrewAIConfig,
	CrewAIHealthResponse,
	CrewRunRequest,
	CrewRunResponse,
	SingleRunRequest,
	SingleRunResponse,
} from "./types.ts";

export class CrewAIProtocol implements Protocol {
	private readonly personas: AgentPersona[];
	private readonly config: CrewAIConfig;
	private readonly onEvent?: ProtocolEventHandler;
	private healthChecked = false;

	constructor(
		personas: AgentPersona[],
		config: CrewAIConfig,
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

		if (this.config.mode === "crew") {
			return this.sendCrewRequest(userId, message, chainId);
		}
		return this.sendSingleRequests(userId, message, chainId);
	}

	private async sendSingleRequests(
		userId: string,
		message: string,
		chainId?: string,
	): Promise<ProtocolResponse> {
		const results = await Promise.all(
			this.personas.map(async (persona): Promise<AgentResult> => {
				log.info("crewai", "agent_start", {
					agent: persona.name,
					mode: "single",
				});
				this.onEvent?.({
					agentName: persona.name,
					type: "state_change",
					detail: `sending to CrewAI (single mode): [${persona.skills.join(", ")}]`,
				});

				const body: SingleRunRequest = {
					agent_name: persona.name,
					message,
					system_prompt: persona.systemPrompt,
					chain_id: chainId,
				};

				const start = performance.now();
				let resp: SingleRunResponse;
				try {
					const raw = await fetch(`${this.config.baseUrl}/run-single`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					});
					if (!raw.ok) {
						throw new Error(
							`CrewAI /run-single returned ${raw.status}: ${await raw.text()}`,
						);
					}
					resp = (await raw.json()) as SingleRunResponse;
				} catch (err) {
					const durationMs = performance.now() - start;
					const errorMsg = err instanceof Error ? err.message : String(err);
					log.error("crewai", "agent_error", {
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

				if (resp.error) {
					log.error("crewai", "agent_error", {
						agent: persona.name,
						error: resp.error,
					});
				}

				log.info("crewai", "agent_complete", {
					agent: persona.name,
					inputTokens: resp.usage?.input_tokens,
					outputTokens: resp.usage?.output_tokens,
					durationMs: Math.round(durationMs),
				});

				return {
					agentName: persona.name,
					skills: persona.skills,
					response: {
						id: crypto.randomUUID(),
						chainId: chainId ?? crypto.randomUUID(),
						replyTo: undefined,
						timestamp: new Date().toISOString(),
						type: "RESPONSE",
						payload: resp.error ?? resp.response_text,
						from: persona.name.toLowerCase(),
						to: [userId],
					},
					usage: resp.usage
						? {
								inputTokens: resp.usage.input_tokens,
								outputTokens: resp.usage.output_tokens,
							}
						: undefined,
					model: resp.model ?? undefined,
					durationMs: resp.duration_ms ?? durationMs,
				};
			}),
		);

		return { results };
	}

	private async sendCrewRequest(
		userId: string,
		message: string,
		chainId?: string,
	): Promise<ProtocolResponse> {
		log.info("crewai", "crew_start", { mode: "crew" });
		this.onEvent?.({
			agentName: "CrewAI",
			type: "state_change",
			detail: "sending to CrewAI (crew mode)",
		});

		const body: CrewRunRequest = { message, chain_id: chainId };
		const start = performance.now();

		let crewResp: CrewRunResponse;
		try {
			const raw = await fetch(`${this.config.baseUrl}/run-crew`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!raw.ok) {
				throw new Error(
					`CrewAI /run-crew returned ${raw.status}: ${await raw.text()}`,
				);
			}
			crewResp = (await raw.json()) as CrewRunResponse;
		} catch (err) {
			const durationMs = performance.now() - start;
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.error("crewai", "crew_error", { error: errorMsg });
			return {
				results: this.personas.map((p) =>
					this.errorResult(p, userId, errorMsg, durationMs),
				),
			};
		}

		if (crewResp.error) {
			log.error("crewai", "crew_error", { error: crewResp.error });
		}

		const results: AgentResult[] = crewResp.results.map((resp) => {
			const persona = this.personas.find((p) => p.name === resp.agent_name);
			return {
				agentName: resp.agent_name,
				skills: persona?.skills ?? [],
				response: {
					id: crypto.randomUUID(),
					chainId: chainId ?? crypto.randomUUID(),
					replyTo: undefined,
					timestamp: new Date().toISOString(),
					type: "RESPONSE" as const,
					payload: resp.error ?? resp.response_text,
					from: resp.agent_name.toLowerCase(),
					to: [userId],
				},
				usage: resp.usage
					? {
							inputTokens: resp.usage.input_tokens,
							outputTokens: resp.usage.output_tokens,
						}
					: undefined,
				model: resp.model ?? undefined,
				durationMs: resp.duration_ms ?? undefined,
			};
		});

		log.info("crewai", "crew_complete", {
			agents: results.length,
			totalDurationMs: Math.round(crewResp.total_duration_ms),
		});

		return { results };
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

		try {
			const raw = await fetch(`${this.config.baseUrl}/health`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!raw.ok) {
				throw new Error(`status ${raw.status}`);
			}
			const health = (await raw.json()) as CrewAIHealthResponse;
			log.info("crewai", "health_ok", { agents: health.agents });
		} catch {
			throw new Error(
				`CrewAI wrapper not reachable at ${this.config.baseUrl}. ` +
					"Start it with: cd external/crewai && uvicorn app.main:app --port 8000",
			);
		}
	}
}
