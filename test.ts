import Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";
import * as readline from "node:readline";

const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const client = new Anthropic();

const PRICING: Record<string, { input: number; output: number }> = {
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
	"claude-sonnet-4-5-20250929": { input: 3, output: 15 },
};

const messages: Anthropic.MessageParam[] = [];

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function prompt(): void {
	rl.question(chalk.green("\nYou: "), async (input) => {
		const trimmed = input.trim();
		if (!trimmed || trimmed === "exit") {
			rl.close();
			return;
		}

		messages.push({ role: "user", content: trimmed });

		const start = performance.now();
		const completion = await client.messages.create({
			model: MODEL,
			max_tokens: 1024,
			system: "You are Atlas, a research assistant. You provide accurate, well-sourced answers to factual questions. Be concise and informative.",
			messages,
		});
		const durationMs = performance.now() - start;

		const text =
			completion.content[0].type === "text" ? completion.content[0].text : "";
		messages.push({ role: "assistant", content: text });

		const { input_tokens, output_tokens } = completion.usage;
		const pricing = PRICING[MODEL];
		const cost = pricing
			? (input_tokens * pricing.input + output_tokens * pricing.output) /
				1_000_000
			: null;

		console.log(`\n${chalk.bold("Agent:")} ${text}`);
		console.log(
			chalk.dim(
				`  ${input_tokens} in · ${output_tokens} out tokens  |  ${cost !== null ? `$${cost.toFixed(4)}  |  ` : ""}${(durationMs / 1000).toFixed(1)}s`,
			),
		);

		prompt();
	});
}

console.log(chalk.bold(`\nSimple Chat REPL (${MODEL})`));
console.log(chalk.dim('Type "exit" or Ctrl+C to quit.\n'));
prompt();
