import * as readline from "node:readline/promises";
import { createAgents } from "./src/agents.ts";
import { log } from "./src/logger.ts";
import { sendUserRequest } from "./src/protocol.ts";
import { store } from "./src/store.ts";

if (!process.env.ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
	process.exit(1);
}

console.log("\n=== Agent-to-Agent Protocol Demo ===\n");

const user = store.registerUser("User");
console.log(`Registered user: ${user.name}`);

const agents = createAgents();
log.info("init", "agents_ready", {
	agents: agents.map((a) => ({ name: a.agent.name, skills: a.agent.skills })),
});
const agentSummary = agents
	.map((a) => `${a.agent.name} (${a.agent.skills.join(", ")})`)
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

	await sendUserRequest(user.id, trimmed);
}
