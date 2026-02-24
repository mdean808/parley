import chalk from "chalk";
import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";
import type { AgentResult } from "./types.ts";

const marked = new Marked(markedTerminal() as unknown as MarkedExtension);

const PRICING: Record<string, { input: number; output: number }> = {
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4 }, // per million tokens
	"claude-sonnet-4-5-20250929": { input: 3, output: 15 },
};

const TERM_WIDTH = process.stdout.columns || 72;

export function renderMarkdown(text: string): string {
	const rendered = marked.parse(text) as string;
	// Indent each line for visual nesting under the header
	return rendered
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}

export function agentHeader(name: string, skills: string[]): string {
	const skillStr = skills.join(", ");
	const label = ` ${name} `;
	const suffix = ` ${skillStr} `;
	const fillLen = TERM_WIDTH - label.length - suffix.length - 4; // 4 for the ── on each side
	const fill = "─".repeat(Math.max(2, fillLen));
	return chalk.bold(`\n── ${name} ${chalk.dim(`${fill} ${skillStr}`)} ──`);
}

export function agentStats(
	usage: { inputTokens: number; outputTokens: number },
	durationMs: number,
	model: string,
): string {
	const tokens = `${usage.inputTokens} in · ${usage.outputTokens} out tokens`;
	const duration = `${(durationMs / 1000).toFixed(1)}s`;

	const pricing = PRICING[model];
	if (pricing) {
		const cost =
			(usage.inputTokens * pricing.input +
				usage.outputTokens * pricing.output) /
			1_000_000;
		return chalk.dim(`  ${tokens}  |  $${cost.toFixed(4)}  |  ${duration}`);
	}

	return chalk.dim(`  ${tokens}  |  ${duration}`);
}

export function summaryBlock(results: AgentResult[]): string {
	const totalIn = results.reduce((s, r) => s + r.usage.inputTokens, 0);
	const totalOut = results.reduce((s, r) => s + r.usage.outputTokens, 0);
	const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

	const model = results[0]?.model ?? "";
	const pricing = PRICING[model];

	const agents = `${results.length} agents`;
	const tokens = `${totalIn} in · ${totalOut} out tokens`;
	const duration = `${(totalMs / 1000).toFixed(1)}s`;

	let inner: string;
	if (pricing) {
		const cost =
			(totalIn * pricing.input + totalOut * pricing.output) / 1_000_000;
		inner = `${agents}  |  ${tokens}  |  $${cost.toFixed(4)}  |  ${duration}`;
	} else {
		inner = `${agents}  |  ${tokens}  |  ${duration}`;
	}

	const label = " Summary ";
	const padLen = Math.max(0, TERM_WIDTH - label.length - 2);
	const left = Math.floor(padLen / 2);
	const right = padLen - left;
	const topLine = `${"─".repeat(left)}${label}${"─".repeat(right)}`;
	const botLine = "─".repeat(TERM_WIDTH);

	return [
		"",
		chalk.dim(topLine),
		chalk.dim(`  ${inner}`),
		chalk.dim(botLine),
	].join("\n");
}

export function separator(): string {
	return chalk.dim("─".repeat(TERM_WIDTH));
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createSpinner(text: string) {
	let i = 0;
	const id = setInterval(() => {
		const frame = SPINNER_FRAMES[i % SPINNER_FRAMES.length];
		process.stdout.write(`\r${chalk.cyan(frame)} ${chalk.dim(text)}`);
		i++;
	}, 80);

	return {
		stop() {
			clearInterval(id);
			process.stdout.write(`\r${" ".repeat(text.length + 4)}\r`);
		},
	};
}
