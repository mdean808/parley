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
import { ProtocolAgentParley } from "./agent.ts";
import { StoreParley } from "./store.ts";
import { encodeMessageParley, encodeOutboundParley } from "./toon.ts";
import type { AgentMeta, MessageParley } from "./types.ts";

const ORCHESTRATOR_INSTRUCTIONS = `

## Orchestration Duties

You hold orchestration skills, so you are responsible for coordinating multi-skill work. When you accept a REQUEST that spans multiple skill domains:

1. In PROCESS, call \`query_agents(skills)\` to identify a specialist for each sub-task.
2. For each sub-task, start a sub-chain by calling \`store_message\` with:
   - a NEW \`chainId\` (you are the originator of this sub-chain)
   - \`type: REQUEST\`
   - \`to: [specialist-agent-id]\` (unicast, NOT \`*\` and NOT a channel)
   - \`replyTo\` set to your PROCESS message id on the parent chain
   - \`payload\` describing only that sub-task
3. Poll \`get_message({ chainId: sub-chainId, type: "RESPONSE" })\` until each specialist replies. Track which sub-chains you spawned so you can propagate CANCEL if needed (spec §CANCEL).
4. Compose a single RESPONSE on the PARENT chain that synthesizes the specialists' outputs. Reference and integrate their work — do NOT reproduce it verbatim.

If the request is single-skill and a specialist is clearly better suited, decline per the normal ACK rules — orchestration is only for multi-skill work.`;

function deriveCustomInstructions(persona: AgentPersona): string {
	const base = persona.systemPrompt + CONVERSATION_CONTEXT_NOTE;
	const isOrchestrator = persona.skills.some(
		(s) => s === "orchestration" || s === "collaboration",
	);
	return isOrchestrator ? base + ORCHESTRATOR_INSTRUCTIONS : base;
}

export interface ParleyProtocolConfig {
	personas: AgentPersona[];
	soloAgentName?: string;
	customTools?: Anthropic.Messages.Tool[];
	onEvent?: ProtocolEventHandler;
	onMessage?: ProtocolMessageHandler;
}

export class ParleyProtocol implements Protocol {
	private readonly config: ParleyProtocolConfig;
	private readonly store: StoreParley = new StoreParley();
	private readonly agentMeta: Map<string, AgentMeta> = new Map();
	private readonly protocolAgents: ProtocolAgentParley[] = [];
	private soloAgentId: string | undefined;

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

	constructor(config: ParleyProtocolConfig) {
		this.config = config;
	}

	initialize(userName: string): ProtocolInit {
		const user = this.store.registerUser(userName);

		const agents = this.config.personas.map((persona) => {
			const agent = this.store.registerAgent(persona.name, persona.skills);
			const protocolAgent = new ProtocolAgentParley(this.store, {
				agent,
				systemPrompt: persona.systemPrompt,
				customInstructions: deriveCustomInstructions(persona),
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
		this.store.subscribe(user.id, (_toon: string, msg: MessageParley) => {
			this.handleIncomingMessage(msg);
		});

		if (this.config.soloAgentName) {
			const soloName = this.config.soloAgentName;
			const match = this.protocolAgents.find((pa) =>
				pa.agent.name.startsWith(soloName),
			);
			if (match) {
				this.soloAgentId = match.agent.id;
			}
		}

		log.info("init_parley", "agents_ready", { agents });

		return { userId: user.id, userName: user.name, agents };
	}

	async sendRequest(
		userId: string,
		message: string,
		providedChainId?: string,
	): Promise<SendResult> {
		const chainId = providedChainId ?? crypto.randomUUID();

		const request = this.store.storeMessage(
			encodeOutboundParley({
				chainId,
				replyTo: undefined,
				type: "REQUEST",
				payload: message,
				from: userId,
				to: this.soloAgentId ? [this.soloAgentId] : ["*"],
			}),
		);

		log.info("protocol_parley", "request_sent", {
			chainId,
			userId,
			payload: message,
			requestId: request.id,
		});

		const requestToon = encodeMessageParley(request);

		// Create completion tracker — resolves when all agents respond or decline
		const settled = new Promise<void>((resolve) => {
			const total = this.soloAgentId ? 1 : this.protocolAgents.length;
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
	private handleIncomingMessage(msg: MessageParley): void {
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

		log.info("protocol_parley", "result_delivered", {
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
		if (this.soloAgentId && agentId !== this.soloAgentId) return;
		tracker.done.add(agentId);
		if (tracker.done.size >= tracker.total) {
			clearTimeout(tracker.hardTimer);
			this.chainTrackers.delete(chainId);
			tracker.resolve();
		}
	}
}
