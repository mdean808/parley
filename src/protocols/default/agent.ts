import type { Agent, AgentBrain, BrainMeta, Message } from "../../types.ts";
import { log } from "./logger.ts";
import { store } from "./store.ts";
import { encodeOutbound } from "./toon.ts";

/**
 * An event-driven protocol agent that subscribes to the store, delegates
 * skill evaluation and response generation to an injected AgentBrain, and
 * follows the ACK → PROCESS → RESPONSE state machine for relevant requests.
 */
export class ProtocolAgent {
	readonly agent: Agent;
	private readonly brain: AgentBrain;
	private readonly allSkills: string[];
	private readonly onMeta: (responseId: string, meta: BrainMeta) => void;

	constructor(
		agent: Agent,
		brain: AgentBrain,
		allSkills: string[],
		onMeta: (responseId: string, meta: BrainMeta) => void,
	) {
		this.agent = agent;
		this.brain = brain;
		this.allSkills = allSkills;
		this.onMeta = onMeta;
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
	 * Handles an incoming message from the store. Ignores non-REQUEST messages.
	 * For REQUESTs, delegates skill evaluation to the brain, then sends
	 * ACK → PROCESS → RESPONSE via `store.sendMessage()`.
	 * If the brain call fails after ACK, still sends an error RESPONSE to fulfill the ACK contract.
	 */
	private async onMessage(
		toonMessage: string,
		message: Message,
	): Promise<void> {
		if (message.type !== "REQUEST") return;

		const component: string = `agent:${this.agent.name}`;

		const brainRequest = {
			agent: this.agent,
			payload: message.payload,
			rawMessage: toonMessage,
			allSkills: this.allSkills,
		};

		const relevant: boolean = await this.brain.shouldHandle(brainRequest);
		if (!relevant) {
			log.info(component, "request_declined", {
				requestId: message.id,
				chainId: message.chainId,
				reason: "no matching skills",
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

		// Brain call
		try {
			const result = await this.brain.generateResponse(brainRequest);

			// RESPONSE
			const response: Message = store.sendMessage(
				encodeOutbound({
					chainId: message.chainId,
					replyTo: message.id,
					type: "RESPONSE",
					payload: result.text,
					from: this.agent.id,
					to: [message.from],
				}),
			);
			log.info(component, "response_sent", {
				chainId: message.chainId,
				requestId: message.id,
				responseId: response.id,
				payloadLength: result.text.length,
			});

			this.onMeta(response.id, result.meta);
		} catch (error: unknown) {
			const errorMessage: string =
				error instanceof Error ? error.message : String(error);
			log.error(component, "brain_call_failed", {
				chainId: message.chainId,
				requestId: message.id,
				error: errorMessage,
			});

			// Fulfill ACK contract: MUST eventually send RESPONSE or error
			store.sendMessage(
				encodeOutbound({
					chainId: message.chainId,
					replyTo: message.id,
					type: "RESPONSE",
					payload: `Error: ${this.agent.name} failed to process request: ${errorMessage}`,
					from: this.agent.id,
					to: [message.from],
				}),
			);
		}
	}
}
