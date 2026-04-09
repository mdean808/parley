import type Anthropic from "@anthropic-ai/sdk";
import { client, MODEL } from "../../config.ts";
import type {
	AgentPersona,
	AgentResult,
	Protocol,
	ProtocolEventHandler,
	ProtocolInit,
	ProtocolResponse,
} from "../../types.ts";

/**
 * Bare-bones protocol that calls Claude directly with no state machine,
 * TOON encoding, or multi-agent routing. Maintains per-agent conversation
 * history for multi-turn chat. Useful as a baseline comparison against
 * DefaultProtocolV2.
 */
export class SimpleProtocol implements Protocol {
	private readonly personas: AgentPersona[];
	private readonly histories: Map<string, Anthropic.MessageParam[]> = new Map();
	private readonly onEvent?: ProtocolEventHandler;

	constructor(personas: AgentPersona[], onEvent?: ProtocolEventHandler) {
		this.personas = personas;
		this.onEvent = onEvent;
		for (const persona of personas) {
			this.histories.set(persona.name, []);
		}
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
	): Promise<ProtocolResponse> {
		const results = await Promise.all(
			this.personas.map(async (persona): Promise<AgentResult> => {
				this.onEvent?.({
					agentName: persona.name,
					type: "state_change",
					detail: `generating response using skills: [${persona.skills.join(", ")}]`,
				});
				const history = this.histories.get(persona.name) ?? [];
				history.push({ role: "user", content: message });

				const start: number = performance.now();
				const completion = await client.messages.create({
					model: MODEL,
					max_tokens: 1024,
					system: persona.systemPrompt,
					messages: history,
				});
				const durationMs: number = performance.now() - start;

				const text: string =
					completion.content[0].type === "text"
						? completion.content[0].text
						: "";
				history.push({ role: "assistant", content: text });

				return {
					agentName: persona.name,
					skills: persona.skills,
					response: {
						id: crypto.randomUUID(),
						chainId: crypto.randomUUID(),
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

		return { results };
	}
}
