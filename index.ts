import * as readline from "node:readline/promises";
import { createAgentPersonas } from "./src/agents.ts";
import { ClaudeBrain } from "./src/brain.ts";
import {
	agentHeader,
	agentStats,
	createSpinner,
	renderMarkdown,
	summaryBlock,
} from "./src/chat/display.ts";
import { DefaultProtocol } from "./src/protocols/default/index.ts";
import type { Protocol } from "./src/types.ts";

if (!process.env.ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
	process.exit(1);
}

console.log("\n=== Agent-to-Agent Protocol Demo ===\n");

const protocol: Protocol = new DefaultProtocol({
	personas: createAgentPersonas(),
	createBrain: (_agent, systemPrompt) => new ClaudeBrain(systemPrompt),
});
const { userId, agents } = await protocol.initialize("User");

console.log("Registered user: User");
const agentSummary = agents
	.map((a) => `${a.name} (${a.skills.join(", ")})`)
	.join(" · ");
console.log(`Agents: ${agentSummary}\n`);

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

while (true) {
	const input = await rl.question("> ");
	const trimmed = input.trim();

	if (trimmed === "exit") {
		console.log("Goodbye!");
		rl.close();
		process.exit(0);
	}

	if (!trimmed) continue;

	const spinner = createSpinner("Waiting for agents...");
	const { results } = await protocol.sendRequest(userId, trimmed);
	spinner.stop();

	if (results.length === 0) {
		console.log("\nNo agents had relevant skills for this request.\n");
		continue;
	}

	for (const result of results) {
		console.log(agentHeader(result.agentName, result.skills));
		console.log(renderMarkdown(result.response.payload));
		console.log(agentStats(result.usage, result.durationMs, result.model));
	}

	console.log(summaryBlock(results));
}
