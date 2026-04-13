import type Anthropic from "@anthropic-ai/sdk";
import { HARD_TIMEOUT_MS } from "core/config";
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

	/** Per-chain completion tracking: resolves when all agents respond or decline. */
	private readonly chainTrackers: Map<
		string,
		{
			total: number;
			done: Set<string>;
			resolve: () => void;
			hardTimer: ReturnType<typeof setTimeout>;
		}
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
				onDecline: (chainId: string) => {
					this.markAgentDone(chainId, agent.id);
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

		// Create completion tracker — resolves when all agents respond or decline
		const settled = new Promise<void>((resolve) => {
			const total = this.protocolAgents.length;
			if (total === 0) {
				resolve();
				return;
			}
			const tracker = {
				total,
				done: new Set<string>(),
				resolve,
				hardTimer: setTimeout(() => {
					this.chainTrackers.delete(chainId);
					resolve();
				}, HARD_TIMEOUT_MS),
			};
			this.chainTrackers.set(chainId, tracker);
		});

		return { chainId, requestId: request.id, requestToon, settled };
	}

	/** Handles messages delivered to the user via store subscription. */
	private handleIncomingMessage(msg: MessageV2): void {
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
		this.markAgentDone(msg.chainId, agent.id);
	}

	/** Marks an agent as done on a chain. Resolves the settled promise when all agents are done. */
	private markAgentDone(chainId: string, agentId: string): void {
		const tracker = this.chainTrackers.get(chainId);
		if (!tracker) return;
		tracker.done.add(agentId);
		if (tracker.done.size >= tracker.total) {
			clearTimeout(tracker.hardTimer);
			this.chainTrackers.delete(chainId);
			tracker.resolve();
		}
	}
}
