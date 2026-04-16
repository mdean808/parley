import type Anthropic from "@anthropic-ai/sdk";
import { client, MODEL } from "core/config";
import type {
	AgentPersona,
	AgentResult,
	Protocol,
	ProtocolEventHandler,
	ProtocolInit,
	ProtocolMessageHandler,
	SendResult,
} from "core/types";
import { log } from "../logger.ts";

/**
 * Bare-bones protocol that calls Claude directly with no state machine,
 * TOON encoding, or multi-agent routing. Maintains per-agent conversation
 * history for multi-turn chat. Useful as a baseline comparison against
 * ParleyProtocol.
 */
export class SimpleProtocol implements Protocol {
	private readonly personas: AgentPersona[];
	private readonly history: Anthropic.MessageParam[] = [];
	private readonly onEvent?: ProtocolEventHandler;
	private readonly onMessage?: ProtocolMessageHandler;
	private readonly soloAgentName?: string;

	constructor(
		personas: AgentPersona[],
		onEvent?: ProtocolEventHandler,
		onMessage?: ProtocolMessageHandler,
		soloAgentName?: string,
	) {
		this.personas = personas;
		this.onEvent = onEvent;
		this.onMessage = onMessage;
		this.soloAgentName = soloAgentName;
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
		_userId: string,
		message: string,
		_chainId?: string,
	): Promise<SendResult> {
		const chainId = _chainId ?? crypto.randomUUID();
		const requestId = crypto.randomUUID();

		// Build messages for this turn: shared history + current user message
		const messages: Anthropic.MessageParam[] = [
			...this.history,
			{ role: "user", content: message },
		];

		const activePersonas = this.soloAgentName
			? this.personas.filter((p) => p.name.startsWith(this.soloAgentName))
			: this.personas;

		const results = await Promise.all(
			activePersonas.map(async (persona): Promise<AgentResult> => {
				log.info("simple", "agent_start", {
					agent: persona.name,
					skills: persona.skills,
				});
				this.onEvent?.({
					agentName: persona.name,
					type: "state_change",
					detail: `generating response using skills: [${persona.skills.join(", ")}]`,
				});

				const start: number = performance.now();
				const completion = await client.messages.create({
					model: MODEL,
					max_tokens: 1024,
					system: persona.systemPrompt,
					messages,
				});
				const durationMs: number = performance.now() - start;

				log.info("simple", "agent_complete", {
					agent: persona.name,
					inputTokens: completion.usage.input_tokens,
					outputTokens: completion.usage.output_tokens,
					durationMs: Math.round(durationMs),
				});

				const text: string =
					completion.content[0].type === "text"
						? completion.content[0].text
						: "";

				return {
					agentName: persona.name,
					skills: persona.skills,
					response: {
						id: crypto.randomUUID(),
						chainId,
						replyTo: undefined,
						timestamp: new Date().toISOString(),
						type: "RESPONSE",
						payload: text,
						from: persona.name.toLowerCase(),
						to: [_userId],
					},
					usage: {
						inputTokens: completion.usage.input_tokens,
						outputTokens: completion.usage.output_tokens,
					},
					model: MODEL,
					durationMs,
				};
			}),
		);

		// Emit each result via onMessage callback
		for (const result of results) {
			this.onMessage?.(result, chainId);
		}

		// Append user message and combined agent responses to shared history
		this.history.push({ role: "user", content: message });
		const combined = results
			.map((r) => `[${r.agentName}]: ${r.response.payload}`)
			.join("\n\n");
		this.history.push({ role: "assistant", content: combined });

		return { chainId, requestId, settled: Promise.resolve() };
	}
}
