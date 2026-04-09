import { log } from "../../logger.ts";
import type {
	Agent,
	AgentPersona,
	AgentResult,
	Message,
	Protocol,
	ProtocolEventHandler,
	ProtocolInit,
	ProtocolResponse,
} from "../../types.ts";
import type { AgentBrain, BrainMeta } from "./types.ts";
import { ProtocolAgent } from "./agent.ts";
import { store } from "./store.ts";
import { encodeOutbound } from "./toon.ts";

/** Maximum time (ms) to wait for agents to send ACKs before assuming they declined. */
const ACK_WINDOW_MS: number = 5_000;

/** Maximum time (ms) to wait for all responses before resolving with whatever has arrived. */
const HARD_TIMEOUT_MS: number = 30_000;

/** Wire-format instruction appended to each agent's system prompt by the protocol. */
const TOON_NOTE: string =
	" You receive messages encoded in TOON (Token Object Over Network) format. Extract the payload field from the TOON message to understand the user's request, and respond with plain text.";

export interface DefaultProtocolConfig {
	personas: AgentPersona[];
	createBrain: (agent: Agent, systemPrompt: string) => AgentBrain;
	onEvent?: ProtocolEventHandler;
}

/**
 * Default protocol implementation that uses the in-memory store and
 * injected AgentBrains. Handles user/agent registration, message
 * broadcasting, ACK/RESPONSE collection, and timeouts.
 *
 * All display concerns are left to the caller.
 */
export class DefaultProtocol implements Protocol {
	private readonly config: DefaultProtocolConfig;
	private readonly brainMeta: Map<string, BrainMeta> = new Map();

	constructor(config: DefaultProtocolConfig) {
		this.config = config;
	}

	/**
	 * Registers a user and all configured agent personas in the store,
	 * then starts each agent's message subscription.
	 *
	 * @param userName - Display name for the user.
	 * @returns The registered user ID, name, and summary of available agents.
	 */
	initialize(userName: string): ProtocolInit {
		const user = store.registerUser(userName);
		const allSkills: string[] = [
			...new Set(this.config.personas.flatMap((p) => p.skills)),
		];

		const agents = this.config.personas.map((persona) => {
			const agent = store.registerAgent(persona.name, persona.skills);
			const brain = this.config.createBrain(
				agent,
				persona.systemPrompt + TOON_NOTE,
			);
			const protocolAgent = new ProtocolAgent(
				agent,
				brain,
				allSkills,
				(responseId: string, meta: BrainMeta) => {
					this.brainMeta.set(responseId, meta);
				},
				this.config.onEvent,
			);
			protocolAgent.start();
			return { name: agent.name, skills: agent.skills };
		});

		log.info("init", "agents_ready", { agents });

		return { userId: user.id, userName: user.name, agents };
	}

	/**
	 * Sends a user's request to all agents via the store's pub/sub system and
	 * collects responses. Uses a two-phase timeout:
	 *
	 * 1. ACK window (5s): if no agent ACKs within this period, resolves immediately.
	 * 2. Hard timeout (30s): resolves with whatever responses have arrived.
	 * 3. Early resolve: completes as soon as all ACKed agents have sent RESPONSE.
	 *
	 * @param userId - The ID of the user sending the request.
	 * @param message - The user's request text.
	 * @returns The collected agent results (may be empty if no agents matched).
	 */
	async sendRequest(
		userId: string,
		message: string,
		providedChainId?: string,
	): Promise<ProtocolResponse> {
		const chainId: string = providedChainId ?? crypto.randomUUID();

		const ackedAgentIds: Set<string> = new Set<string>();
		const responses: Map<string, Message> = new Map();

		let resolveCollector: () => void;
		const collectorDone: Promise<void> = new Promise<void>((resolve) => {
			resolveCollector = resolve;
		});

		/** Resolves the collector promise once all ACKed agents have responded. */
		function checkComplete(): void {
			if (ackedAgentIds.size > 0 && ackedAgentIds.size === responses.size) {
				resolveCollector();
			}
		}

		store.subscribe(userId, (_toonMessage: string, msg: Message) => {
			if (msg.chainId !== chainId) return;

			if (msg.type === "ACK") {
				ackedAgentIds.add(msg.from);
			} else if (msg.type === "RESPONSE" || msg.type === "ERROR") {
				responses.set(msg.from, msg);
				checkComplete();
			}
		});

		const request: Message = store.sendMessage(
			encodeOutbound({
				chainId,
				replyTo: undefined,
				type: "REQUEST",
				payload: message,
				from: userId,
				to: ["*"],
			}),
		);

		log.info("protocol", "request_sent", {
			chainId,
			userId,
			payload: message,
			requestId: request.id,
		});

		const broadcastStart: number = performance.now();

		// Wait for ACK window, then hard timeout, or early resolve
		const ackWindowTimeout: ReturnType<typeof setTimeout> = setTimeout(() => {
			if (ackedAgentIds.size === 0) {
				resolveCollector();
			}
		}, ACK_WINDOW_MS);

		const hardTimeout: ReturnType<typeof setTimeout> = setTimeout(() => {
			resolveCollector();
		}, HARD_TIMEOUT_MS);

		await collectorDone;

		clearTimeout(ackWindowTimeout);
		clearTimeout(hardTimeout);
		store.unsubscribe(userId);

		const totalDurationMs: number = performance.now() - broadcastStart;

		if (responses.size === 0) {
			log.warn("protocol", "no_agents_matched", {
				chainId,
				payload: message,
			});
			return { results: [] };
		}

		// Build AgentResult array
		const results: AgentResult[] = [];
		for (const [agentId, response] of responses) {
			const [agent] = store.getAgent([agentId]);
			if (!agent) continue;

			const meta = this.brainMeta.get(response.id);
			results.push({
				agentName: agent.name,
				skills: agent.skills,
				response,
				usage: meta?.usage,
				model: meta?.model,
				durationMs: meta?.durationMs,
			});
		}

		const respondedAgents: string[] = results.map((r) => r.agentName);
		log.info("protocol", "request_complete", {
			chainId,
			respondedAgents,
			totalDurationMs,
		});

		return { results };
	}
}
