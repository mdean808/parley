import * as readline from "node:readline/promises";
import { registerUser } from "./src/store.ts";
import { createAgents } from "./src/agents.ts";
import { broadcastRequest } from "./src/protocol.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
  process.exit(1);
}

console.log("\n=== Agent-to-Agent Protocol Demo ===\n");

const user = registerUser("User");
console.log(`Registered user: ${user.name} (${user.id})\n`);

console.log("Agents:");
const agents = createAgents();

console.log(`\nType a message to broadcast to all agents. Type "exit" to quit.\n`);

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

  await broadcastRequest(user.id, trimmed, agents);
}
