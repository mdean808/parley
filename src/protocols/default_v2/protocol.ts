import type Anthropic from "@anthropic-ai/sdk";
import { log } from "../../logger.ts";
import type {
	AgentPersona,
	AgentResult,
	Message,
	Protocol,
	ProtocolInit,
	ProtocolResponse,
} from "../../types.ts";
import { ProtocolAgentV2 } from "./agent.ts";
import { StoreV2 } from "./store.ts";
import { encodeOutboundV2 } from "./toon.ts";
import type { AgentMeta, MessageV2 } from "./types.ts";

const ACK_WINDOW_MS = 5_000;
const HARD_TIMEOUT_MS = 30_000;

export interface DefaultProtocolV2Config {
	personas: AgentPersona[];
	customTools?: Anthropic.Messages.Tool[];
	ackWindowMs?: number;
	hardTimeoutMs?: number;
}

export class DefaultProtocolV2 implements Protocol {
	private readonly config: DefaultProtocolV2Config;
	private readonly store: StoreV2 = new StoreV2();
	private readonly agentMeta: Map<string, AgentMeta> = new Map();
	private readonly protocolAgents: ProtocolAgentV2[] = [];

	constructor(config: DefaultProtocolV2Config) {
		this.config = config;
	}

	initialize(userName: string): ProtocolInit {
		const user = this.store.registerUser(userName);

		const agents = this.config.personas.map((persona) => {
			const agent = this.store.registerAgent(persona.name, persona.skills);
			const protocolAgent = new ProtocolAgentV2(this.store, {
				agent,
				systemPrompt: persona.systemPrompt,
				customInstructions: persona.systemPrompt,
				customTools: this.config.customTools,
				onMeta: (chainId: string, meta: AgentMeta) => {
					// Key by agentId:chainId for per-agent per-chain tracking
					this.agentMeta.set(`${agent.id}:${chainId}`, meta);
				},
			});
			protocolAgent.start();
			this.protocolAgents.push(protocolAgent);
			return { name: agent.name, skills: agent.skills };
		});

		log.info("init_v2", "agents_ready", { agents });

		return { userId: user.id, userName: user.name, agents };
	}

	async sendRequest(
		userId: string,
		message: string,
		providedChainId?: string,
	): Promise<ProtocolResponse> {
		const chainId = providedChainId ?? crypto.randomUUID();
		const ackWindowMs = this.config.ackWindowMs ?? ACK_WINDOW_MS;
		const hardTimeoutMs = this.config.hardTimeoutMs ?? HARD_TIMEOUT_MS;

		const ackedAgentIds = new Set<string>();
		const responses = new Map<string, MessageV2>();

		let resolveCollector: () => void;
		const collectorDone = new Promise<void>((resolve) => {
			resolveCollector = resolve;
		});

		function checkComplete(): void {
			if (ackedAgentIds.size > 0 && ackedAgentIds.size === responses.size) {
				resolveCollector();
			}
		}

		this.store.subscribe(userId, (_toon: string, msg: MessageV2) => {
			if (msg.chainId !== chainId) return;

			if (msg.type === "ACK") {
				ackedAgentIds.add(msg.from);
			} else if (msg.type === "RESPONSE" || msg.type === "ERROR") {
				responses.set(msg.from, msg);
				checkComplete();
			}
		});

		const request = this.store.storeMessage(
			encodeOutboundV2({
				chainId,
				replyTo: undefined,
				type: "REQUEST",
				payload: message,
				from: userId,
				to: ["*"],
			}),
		);

		log.info("protocol_v2", "request_sent", {
			chainId,
			userId,
			payload: message,
			requestId: request.id,
		});

		const broadcastStart = performance.now();

		const ackWindowTimeout = setTimeout(() => {
			if (ackedAgentIds.size === 0) {
				resolveCollector();
			}
		}, ackWindowMs);

		const hardTimeout = setTimeout(() => {
			resolveCollector();
		}, hardTimeoutMs);

		await collectorDone;

		clearTimeout(ackWindowTimeout);
		clearTimeout(hardTimeout);
		this.store.unsubscribe(userId);

		const totalDurationMs = performance.now() - broadcastStart;

		if (responses.size === 0) {
			log.warn("protocol_v2", "no_agents_matched", {
				chainId,
				payload: message,
			});
			return { results: [] };
		}

		// Map MessageV2 → shared Message type for AgentResult compatibility
		const results: AgentResult[] = [];
		for (const [agentId, response] of responses) {
			const [agent] = this.store.getAgent([agentId]);
			if (!agent) continue;

			const meta = this.agentMeta.get(`${agentId}:${chainId}`);
			const sharedMessage: Message = {
				id: response.id,
				chainId: response.chainId,
				replyTo: response.replyTo,
				timestamp: response.timestamp,
				type: response.type,
				payload: response.payload,
				from: response.from,
				to: response.to,
			};

			results.push({
				agentName: agent.name,
				skills: agent.skills,
				response: sharedMessage,
				usage: meta?.usage,
				model: meta?.model,
				durationMs: meta?.durationMs,
			});
		}

		log.info("protocol_v2", "request_complete", {
			chainId,
			respondedAgents: results.map((r) => r.agentName),
			totalDurationMs,
		});

		return { results };
	}
}
