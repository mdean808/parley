import { createAgentPersonas } from "./agents.ts";
import { ClaudeBrain } from "./brain.ts";
import { DefaultProtocol } from "./protocols/default_v1/index.ts";
import { DefaultProtocolV2 } from "./protocols/default_v2/index.ts";
import { SimpleProtocol } from "./protocols/simple/index.ts";
import type { Protocol, ProtocolEventHandler } from "./types.ts";

export type ProtocolId = "v1" | "v2" | "simple";

export interface ProtocolOptions {
	onEvent?: ProtocolEventHandler;
}

export function createProtocol(
	id: ProtocolId,
	options?: ProtocolOptions,
): Protocol {
	const personas = createAgentPersonas();
	switch (id) {
		case "v1":
			return new DefaultProtocol({
				personas,
				createBrain: (_agent, systemPrompt) => new ClaudeBrain(systemPrompt),
				onEvent: options?.onEvent,
			});
		case "v2":
			return new DefaultProtocolV2({
				personas,
				onEvent: options?.onEvent,
			});
		case "simple":
			return new SimpleProtocol(personas, options?.onEvent);
	}
}
