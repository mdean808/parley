import type {
	Protocol,
	ProtocolEventHandler,
	ProtocolMessageHandler,
} from "core/types";
import { A2AProtocol } from "./a2a/index.ts";
import { createAgentPersonas, getA2AUrls } from "./agents.ts";
import { ClaudeCodeProtocol } from "./claude-code/index.ts";
import { CrewAIProtocol } from "./crewai/index.ts";
import { ParleyProtocol } from "./parley/index.ts";
import { SimpleProtocol } from "./simple/index.ts";

export type ProtocolId = string;

export interface ProtocolOptions {
	onEvent?: ProtocolEventHandler;
	onMessage?: ProtocolMessageHandler;
	soloAgentName?: string;
}

export interface ProtocolRegistration {
	label: string;
	description: string;
	supportsRouting?: boolean;
	create: (options?: ProtocolOptions) => Protocol;
}

const registry = new Map<string, ProtocolRegistration>();

export function registerProtocol(
	id: string,
	registration: ProtocolRegistration,
): void {
	registry.set(id, registration);
}

export function getProtocolIds(): string[] {
	return [...registry.keys()];
}

export function getProtocolRegistration(
	id: string,
): ProtocolRegistration | undefined {
	return registry.get(id);
}

export function createProtocol(
	id: string,
	options?: ProtocolOptions,
): Protocol {
	const reg = registry.get(id);
	if (!reg) {
		throw new Error(
			`Unknown protocol "${id}". Available: ${getProtocolIds().join(", ")}`,
		);
	}
	return reg.create(options);
}

// Register built-in protocols
registerProtocol("parley", {
	label: "Parley Protocol",
	description: "agentic tool-use, chains, channels, TOON",
	supportsRouting: true,
	create: (options) => {
		const personas = createAgentPersonas();
		return new ParleyProtocol({
			personas,
			soloAgentName: options?.soloAgentName,
			onEvent: options?.onEvent,
			onMessage: options?.onMessage,
		});
	},
});

registerProtocol("simple", {
	label: "Simple Protocol",
	description: "direct chat, multi-agent, no overhead",
	create: (options) => {
		const personas = createAgentPersonas();
		return new SimpleProtocol(
			personas,
			options?.onEvent,
			options?.onMessage,
			options?.soloAgentName,
		);
	},
});

registerProtocol("claude-code", {
	label: "Claude Code",
	description: "Claude Code CLI, single-agent agentic baseline",
	create: (options) =>
		new ClaudeCodeProtocol(options?.onEvent, undefined, options?.onMessage),
});

registerProtocol("a2a", {
	label: "A2A Protocol",
	description: "Google A2A, HTTP JSON-RPC, multi-agent",
	create: (options) => {
		const personas = createAgentPersonas();
		return new A2AProtocol(
			personas,
			{ agentUrls: getA2AUrls() },
			options?.onEvent,
			options?.onMessage,
		);
	},
});

registerProtocol("crewai", {
	label: "CrewAI",
	description: "CrewAI via FastAPI wrapper, multi-agent",
	create: (options) => {
		const personas = createAgentPersonas();
		return new CrewAIProtocol(
			personas,
			{
				baseUrl: process.env.CREWAI_URL ?? "http://localhost:8000",
				mode: (process.env.CREWAI_MODE as "single" | "crew") ?? "single",
			},
			options?.onEvent,
			options?.onMessage,
		);
	},
});
