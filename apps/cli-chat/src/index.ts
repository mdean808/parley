import * as readline from "node:readline/promises";
import {
	agentHeader,
	agentStats,
	agentThought,
	renderMarkdown,
	summaryBlock,
} from "./display.ts";
import {
	createProtocol,
	getProtocolIds,
	getProtocolRegistration,
} from "protocols/factory";
import type { ProtocolEvent } from "core/types";

if (!process.env.ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
	process.exit(1);
}

/** Arrow-key menu for selecting a protocol. Returns the chosen index. */
async function selectProtocol(
	options: { label: string; description: string }[],
): Promise<number> {
	let selected = 0;

	const render = () => {
		// Move cursor up to overwrite previous render (skip on first render)
		process.stdout.write(`\x1b[${options.length}A`);
		for (let i = 0; i < options.length; i++) {
			const prefix = i === selected ? "❯ " : "  ";
			const label =
				i === selected ? `\x1b[1m${options[i].label}\x1b[0m` : options[i].label;
			process.stdout.write(
				`\r\x1b[K${prefix}${label} \x1b[2m— ${options[i].description}\x1b[0m\n`,
			);
		}
	};

	// Initial render
	console.log("\n=== Agent-to-Agent Protocol Demo ===\n");
	console.log("Select a protocol:\n");
	for (let i = 0; i < options.length; i++) {
		process.stdout.write("\n");
	}
	render();

	return new Promise<number>((resolve) => {
		const stdin = process.stdin;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		const onData = (key: string) => {
			if (key === "\x1b[A") {
				// Up arrow
				selected = (selected - 1 + options.length) % options.length;
				render();
			} else if (key === "\x1b[B") {
				// Down arrow
				selected = (selected + 1) % options.length;
				render();
			} else if (key === "\r" || key === "\n") {
				// Enter
				stdin.removeListener("data", onData);
				stdin.setRawMode(false);
				resolve(selected);
			} else if (key === "\x03") {
				// Ctrl+C
				process.exit(0);
			}
		};

		stdin.on("data", onData);
	});
}

const protocolIds = getProtocolIds();
const protocolOptions = protocolIds.map((id) => {
	const reg = getProtocolRegistration(id);
	return {
		label: reg?.label ?? id,
		description: reg?.description ?? "",
	};
});

const choice = await selectProtocol(protocolOptions);

const onEvent = (event: ProtocolEvent) => agentThought(event);

const protocol = createProtocol(protocolIds[choice], { onEvent });

console.log(`\nUsing: ${protocolOptions[choice].label}\n`);

const { userId, agents } = await protocol.initialize("User");
const conversationChainId = crypto.randomUUID();

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

	const { results } = await protocol.sendRequest(
		userId,
		trimmed,
		conversationChainId,
	);

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
