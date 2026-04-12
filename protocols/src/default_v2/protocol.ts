import type Anthropic from "@anthropic-ai/sdk";
import { CHAIN_SETTLE_MS } from "core/config";
import type {
	AgentPersona,
	AgentResult,
	Message,
	MessageType,
	Protocol,
	ProtocolEventHandler,
	ProtocolInit,
	ProtocolMessageHandler,
	SendResult,
} from "core/types";
import { CONVERSATION_CONTEXT_NOTE } from "../agents.ts";
import { log } from "../logger.ts";
import { ProtocolAgentV2 } from "./agent.ts";
import { StoreV2 } from "./store.ts";
import { encodeMessageV2, encodeOutboundV2 } from "./toon.ts";
import type { AgentMeta, MessageV2 } from "./types.ts";

export interface DefaultProtocolV2Config {
	personas: AgentPersona[];
	customTools?: Anthropic.Messages.Tool[];
	onEvent?: ProtocolEventHandler;
	onMessage?: ProtocolMessageHandler;
}

export class DefaultProtocolV2 implements Protocol {
	private readonly config: DefaultProtocolV2Config;
	private readonly store: StoreV2 = new StoreV2();
	private readonly agentMeta: Map<string, AgentMeta> = new Map();
	private readonly protocolAgents: ProtocolAgentV2[] = [];

	/** Per-chain settling: tracks the timer and resolve callback. */
	private readonly chainSettlers: Map<
		string,
		{ timer: ReturnType<typeof setTimeout>; resolve: () => void }
	> = new Map();

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
				customInstructions: persona.systemPrompt + CONVERSATION_CONTEXT_NOTE,
				customTools: this.config.customTools,
				onEvent: this.config.onEvent,
				onMeta: (chainId: string, meta: AgentMeta) => {
					this.agentMeta.set(`${agent.id}:${chainId}`, meta);
				},
			});
			protocolAgent.start();
			this.protocolAgents.push(protocolAgent);
			return { name: agent.name, skills: agent.skills };
		});

		// Subscribe user once for the session lifetime — deliver results via onMessage
		this.store.subscribe(user.id, (_toon: string, msg: MessageV2) => {
			this.handleIncomingMessage(msg);
		});

		log.info("init_v2", "agents_ready", { agents });

		return { userId: user.id, userName: user.name, agents };
	}

	async sendRequest(
		userId: string,
		message: string,
		providedChainId?: string,
	): Promise<SendResult> {
		const chainId = providedChainId ?? crypto.randomUUID();

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

		const requestToon = encodeMessageV2(request);

		// Create a settling promise for this chain
		const settled = this.createSettledPromise(chainId);

		return { chainId, requestId: request.id, requestToon, settled };
	}

	/** Handles messages delivered to the user via store subscription. */
	private handleIncomingMessage(msg: MessageV2): void {
		// Reset the settling timer for this chain on any activity
		this.resetSettleTimer(msg.chainId);

		if (msg.type !== "RESPONSE" && msg.type !== "ERROR") return;

		const [agent] = this.store.getAgent([msg.from]);
		if (!agent) return;

		const meta = this.agentMeta.get(`${agent.id}:${msg.chainId}`);
		const sharedMessage: Message = {
			id: msg.id,
			chainId: msg.chainId,
			replyTo: msg.replyTo,
			timestamp: msg.timestamp,
			type: msg.type as MessageType,
			payload: msg.payload,
			from: msg.from,
			to: msg.to,
		};

		const result: AgentResult = {
			agentName: agent.name,
			skills: agent.skills,
			response: sharedMessage,
			usage: meta?.usage,
			model: meta?.model,
			durationMs: meta?.durationMs,
		};

		log.info("protocol_v2", "result_delivered", {
			chainId: msg.chainId,
			agentName: agent.name,
			type: msg.type,
		});

		this.config.onMessage?.(result, msg.chainId);
	}

	/**
	 * Creates a promise that resolves when chain activity settles
	 * (no new messages to the user for CHAIN_SETTLE_MS).
	 */
	private createSettledPromise(chainId: string): Promise<void> {
		// If there's already a settler for this chain, return a new one
		// that chains off the existing timer reset logic
		const existing = this.chainSettlers.get(chainId);
		if (existing) {
			// Reset the timer — new request on same chain
			this.resetSettleTimer(chainId);
			return new Promise<void>((resolve) => {
				const prev = this.chainSettlers.get(chainId);
				if (prev) {
					const originalResolve = prev.resolve;
					prev.resolve = () => {
						originalResolve();
						resolve();
					};
				}
			});
		}

		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.chainSettlers.delete(chainId);
				resolve();
			}, CHAIN_SETTLE_MS);

			this.chainSettlers.set(chainId, { timer, resolve });
		});
	}

	/** Resets the settling timer for a chain (new activity detected). */
	private resetSettleTimer(chainId: string): void {
		const settler = this.chainSettlers.get(chainId);
		if (!settler) return;

		clearTimeout(settler.timer);
		settler.timer = setTimeout(() => {
			const s = this.chainSettlers.get(chainId);
			if (s) {
				this.chainSettlers.delete(chainId);
				s.resolve();
			}
		}, CHAIN_SETTLE_MS);
	}
}
