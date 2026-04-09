import { createAgentPersonas } from "./agents.ts";
import { ClaudeCodeProtocol } from "./protocols/claude-code/index.ts";
import { DefaultProtocolV2 } from "./protocols/default_v2/index.ts";
import { SimpleProtocol } from "./protocols/simple/index.ts";
import type { Protocol, ProtocolEventHandler } from "./types.ts";

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
