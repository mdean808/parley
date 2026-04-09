import { log } from "../../logger.ts";
import type { Agent, Message, ProtocolEventHandler } from "../../types.ts";
import { store } from "./store.ts";
import { encodeOutbound } from "./toon.ts";
import type {
	AgentBrain,
	BrainMeta,
	BrainRequest,
	BrainResponse,
	DelegationResult,
} from "./types.ts";

const MAX_VALIDATION_ATTEMPTS = 3;
const DELEGATION_ACK_WINDOW_MS = 5_000;
const DELEGATION_HARD_TIMEOUT_MS = 15_000;

interface PendingDelegation {
	chainId: string;
	ackedAgentIds: Set<string>;
	results: DelegationResult[];
	resolve: () => void;
}

/**
 * An event-driven protocol agent that subscribes to the store, delegates
 * skill evaluation and response generation to an injected AgentBrain, and
 * follows the ACK → PROCESS → RESPONSE/ERROR state machine for relevant requests.
 */
export class ProtocolAgent {
	readonly agent: Agent;
	private readonly brain: AgentBrain;
	private readonly allSkills: string[];
	private readonly onMeta: (responseId: string, meta: BrainMeta) => void;
	private readonly onEvent?: ProtocolEventHandler;
	private readonly pendingDelegations: Map<string, PendingDelegation> =
		new Map();
	constructor(
		agent: Agent,
		brain: AgentBrain,
		allSkills: string[],
		onMeta: (responseId: string, meta: BrainMeta) => void,
		onEvent?: ProtocolEventHandler,
	) {
		this.agent = agent;
		this.brain = brain;
		this.allSkills = allSkills;
		this.onMeta = onMeta;
		this.onEvent = onEvent;
	}

	/** Subscribes this agent to the store to begin receiving messages. */
	start(): void {
		store.subscribe(this.agent.id, (toonMessage: string, message: Message) =>
			this.onMessage(toonMessage, message),
		);
		log.info(`agent:${this.agent.name}`, "subscribed", {
			agentId: this.agent.id,
		});
	}

	/** Unsubscribes this agent from the store, stopping message delivery. */
	stop(): void {
		store.unsubscribe(this.agent.id);
		log.info(`agent:${this.agent.name}`, "unsubscribed", {
			agentId: this.agent.id,
		});
	}

	/**
	 * Handles an incoming message from the store.
	 * Routes delegation responses to pending delegation trackers.
	 * For REQUESTs, delegates skill evaluation to the brain, then sends
	 * ACK → PROCESS → RESPONSE/ERROR via `store.sendMessage()`.
	 */
	private async onMessage(
		toonMessage: string,
		message: Message,
	): Promise<void> {
		// Check if this message belongs to a pending delegation chain
		const pendingDelegation = this.pendingDelegations.get(message.chainId);
		if (pendingDelegation) {
			this.handleDelegationResponse(pendingDelegation, message);
			return;
		}

		if (message.type !== "REQUEST") return;

		const component: string = `agent:${this.agent.name}`;

		const brainRequest: BrainRequest = {
			agent: this.agent,
			payload: message.payload,
			rawMessage: toonMessage,
			allSkills: this.allSkills,
		};

		const evalResult = await this.brain.shouldHandle(brainRequest);

		const neededStr =
			evalResult.neededSkills.length > 0
				? evalResult.neededSkills.join(", ")
				: "none identified (fallback)";
		const agentSkillStr = this.agent.skills.join(", ");

		this.onEvent?.({
			agentName: this.agent.name,
			type: "skill_eval",
			detail: `needed: [${neededStr}] | has: [${agentSkillStr}] => ${evalResult.relevant ? "ACCEPT" : "DECLINE"}`,
		});

		if (!evalResult.relevant) {
			log.info(component, "request_declined", {
				requestId: message.id,
				chainId: message.chainId,
				reason: "no matching skills",
			});
			this.onEvent?.({
				agentName: this.agent.name,
				type: "decline",
				detail: `declining — skills [${neededStr}] not matched by [${agentSkillStr}]`,
			});
			return;
		}

		// ACK
		store.sendMessage(
			encodeOutbound({
				chainId: message.chainId,
				replyTo: message.id,
				type: "ACK",
				payload: `${this.agent.name} acknowledged request`,
				from: this.agent.id,
				to: [message.from],
			}),
		);
		log.info(component, "ack_sent", {
			chainId: message.chainId,
			requestId: message.id,
		});
		this.onEvent?.({
			agentName: this.agent.name,
			type: "state_change",
			detail: "ACK sent",
		});

		// PROCESS
		store.sendMessage(
			encodeOutbound({
				chainId: message.chainId,
				replyTo: message.id,
				type: "PROCESS",
				payload: `${this.agent.name} will process this request using skills: ${this.agent.skills.join(", ")}. Analyzing: "${message.payload.slice(0, 100)}"`,
				from: this.agent.id,
				to: [message.from],
			}),
		);
		log.info(component, "process_sent", {
			chainId: message.chainId,
			requestId: message.id,
		});
		this.onEvent?.({
			agentName: this.agent.name,
			type: "state_change",
			detail: "PROCESS sent — generating response",
		});

		// Delegation: if brain supports it and sender is not another agent (recursion guard)
		const senderIsAgent = store.getAgent([message.from]).length > 0;
		if (this.brain.shouldDelegate && !senderIsAgent) {
			const delegationReq = await this.brain.shouldDelegate(brainRequest);
			if (delegationReq) {
				log.info(component, "delegation_requested", {
					chainId: message.chainId,
					targetSkills: delegationReq.targetSkills,
				});
				this.onEvent?.({
					agentName: this.agent.name,
					type: "delegation",
					detail: `delegating to agents with skills: [${delegationReq.targetSkills.join(", ")}]`,
				});

				const targets = store
					.queryAgents(delegationReq.targetSkills)
					.filter((a) => a.id !== this.agent.id);

				if (targets.length > 0 && this.brain.generateDelegatedResponse) {
					const delegationResults = await this.executeDelegation(
						component,
						delegationReq.payload,
						targets,
					);

					if (delegationResults.length > 0) {
						const result = await this.brain.generateDelegatedResponse(
							brainRequest,
							delegationResults,
						);
						this.sendResponseWithRetry(component, message, result);
						return;
					}
				}
				// Fall through to normal response if no targets or no results
			}
		}

		// Normal brain call with retry logic
		try {
			const result = await this.brain.generateResponse(brainRequest);
			this.sendResponseWithRetry(component, message, result);
		} catch (error: unknown) {
			const errorMessage: string =
				error instanceof Error ? error.message : String(error);
			log.error(component, "brain_call_failed", {
				chainId: message.chainId,
				requestId: message.id,
				error: errorMessage,
			});

			// Fulfill ACK contract with ERROR type
			store.sendMessage(
				encodeOutbound({
					chainId: message.chainId,
					replyTo: message.id,
					type: "ERROR",
					payload: `Error: ${this.agent.name} failed to process request: ${errorMessage}`,
					from: this.agent.id,
					to: [message.from],
				}),
			);
		}
	}

	/**
	 * Sends a RESPONSE message with TOON validation retry logic.
	 * If encoding fails 3 times, sends an ERROR message instead.
	 */
	private sendResponseWithRetry(
		component: string,
		originalMessage: Message,
		result: BrainResponse,
	): void {
		for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
			try {
				const encoded = encodeOutbound({
					chainId: originalMessage.chainId,
					replyTo: originalMessage.id,
					type: "RESPONSE",
					payload: result.text,
					from: this.agent.id,
					to: [originalMessage.from],
				});

				const response: Message = store.sendMessage(encoded);
				log.info(component, "response_sent", {
					chainId: originalMessage.chainId,
					requestId: originalMessage.id,
					responseId: response.id,
					payloadLength: result.text.length,
					attempt,
				});

				this.onMeta(response.id, result.meta);
				this.onEvent?.({
					agentName: this.agent.name,
					type: "state_change",
					detail: "RESPONSE sent",
				});
				return;
			} catch (error: unknown) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				log.warn(component, "toon_validation_failed", {
					chainId: originalMessage.chainId,
					requestId: originalMessage.id,
					attempt,
					error: errorMessage,
				});
			}
		}

		// All 3 attempts exhausted
		log.error(component, "toon_validation_exhausted", {
			chainId: originalMessage.chainId,
			requestId: originalMessage.id,
		});

		store.sendMessage(
			encodeOutbound({
				chainId: originalMessage.chainId,
				replyTo: originalMessage.id,
				type: "ERROR",
				payload: "Agent failed to validate message after 3 attempts.",
				from: this.agent.id,
				to: [originalMessage.from],
			}),
		);
	}

	/**
	 * Tracks an incoming message as part of a pending delegation.
	 * Resolves the delegation when all ACKed agents have responded.
	 */
	private handleDelegationResponse(
		delegation: PendingDelegation,
		message: Message,
	): void {
		if (message.type === "ACK") {
			delegation.ackedAgentIds.add(message.from);
		} else if (message.type === "RESPONSE" || message.type === "ERROR") {
			const [agent] = store.getAgent([message.from]);
			delegation.results.push({
				agentName: agent?.name ?? message.from,
				agentId: message.from,
				payload: message.payload,
				type: message.type,
			});

			// Resolve when all ACKed agents have responded
			if (
				delegation.ackedAgentIds.size > 0 &&
				delegation.results.length >= delegation.ackedAgentIds.size
			) {
				delegation.resolve();
			}
		}
	}

	/**
	 * Executes a delegation by sending a REQUEST to target agents and
	 * collecting their responses with ACK window and hard timeout.
	 */
	private async executeDelegation(
		component: string,
		payload: string,
		targets: Agent[],
	): Promise<DelegationResult[]> {
		const chainId = crypto.randomUUID();

		const delegation: PendingDelegation = {
			chainId,
			ackedAgentIds: new Set(),
			results: [],
			resolve: () => {},
		};

		const collectorDone = new Promise<void>((resolve) => {
			delegation.resolve = resolve;
		});

		this.pendingDelegations.set(chainId, delegation);

		// Send delegation REQUEST to target agents
		store.sendMessage(
			encodeOutbound({
				chainId,
				replyTo: undefined,
				type: "REQUEST",
				payload,
				from: this.agent.id,
				to: targets.map((a) => a.id),
			}),
		);

		log.info(component, "delegation_sent", {
			chainId,
			targets: targets.map((a) => a.name),
		});

		// ACK window: resolve early if no agent ACKs
		const ackTimeout = setTimeout(() => {
			if (delegation.ackedAgentIds.size === 0) {
				delegation.resolve();
			}
		}, DELEGATION_ACK_WINDOW_MS);

		// Hard timeout
		const hardTimeout = setTimeout(() => {
			delegation.resolve();
		}, DELEGATION_HARD_TIMEOUT_MS);

		await collectorDone;

		clearTimeout(ackTimeout);
		clearTimeout(hardTimeout);
		this.pendingDelegations.delete(chainId);

		log.info(component, "delegation_complete", {
			chainId,
			resultsCount: delegation.results.length,
		});

		return delegation.results;
	}
}
