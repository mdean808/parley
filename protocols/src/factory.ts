import type { Protocol, ProtocolEventHandler } from "core/types";
import { A2AProtocol } from "./a2a/index.ts";
import { createAgentPersonas } from "./agents.ts";
import { ClaudeCodeProtocol } from "./claude-code/index.ts";
import { CrewAIProtocol } from "./crewai/index.ts";
import { DefaultProtocolV2 } from "./default_v2/index.ts";
import { SimpleProtocol } from "./simple/index.ts";

export type ProtocolId = string;

export interface ProtocolOptions {
	onEvent?: ProtocolEventHandler;
}

export interface ProtocolRegistration {
	label: string;
	description: string;
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
registerProtocol("v2", {
	label: "Default Protocol (v2)",
	description: "agentic tool-use, chains, channels, TOON",
	create: (options) => {
		const personas = createAgentPersonas();
		return new DefaultProtocolV2({
			personas,
			onEvent: options?.onEvent,
		});
	},
});

registerProtocol("simple", {
	label: "Simple Protocol",
	description: "direct chat, multi-agent, no overhead",
	create: (options) => {
		const personas = createAgentPersonas();
		return new SimpleProtocol(personas, options?.onEvent);
	},
});

registerProtocol("claude-code", {
	label: "Claude Code",
	description: "Claude Code CLI, single-agent agentic baseline",
	create: (options) => new ClaudeCodeProtocol(options?.onEvent),
});

registerProtocol("a2a", {
	label: "A2A Protocol",
	description: "Google A2A, HTTP JSON-RPC, multi-agent",
	create: (options) => {
		const personas = createAgentPersonas();
		return new A2AProtocol(
			personas,
			{
				agentUrls: {
					"Atlas - Research":
						process.env.A2A_ATLAS_URL ?? "http://localhost:8001",
					"Sage - Creative":
						process.env.A2A_SAGE_URL ?? "http://localhost:8002",
					"Bolt - Technical":
						process.env.A2A_BOLT_URL ?? "http://localhost:8003",
				},
			},
			options?.onEvent,
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
		);
	},
});
