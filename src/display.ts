import chalk from "chalk";
import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";
import type { AgentResult } from "./types.ts";

const marked = new Marked(markedTerminal() as unknown as MarkedExtension);

/** Per-million-token pricing for supported models. */
const PRICING: Record<string, { input: number; output: number }> = {
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
	"claude-sonnet-4-5-20250929": { input: 3, output: 15 },
};

const TERM_WIDTH: number = process.stdout.columns || 72;

/**
 * Renders markdown text to terminal-formatted output, indented for visual nesting.
 * @param text - Raw markdown string to render.
 * @returns Terminal-formatted string with 2-space indent per line.
 */
export function renderMarkdown(text: string): string {
	const rendered = marked.parse(text) as string;
	return rendered
		.split("\n")
		.map((line: string) => `  ${line}`)
		.join("\n");
}

/**
 * Generates a decorated terminal header line for an agent's response.
 * @param name - The agent's display name.
 * @param skills - The agent's skill list.
 * @returns Formatted header string with agent name and skills.
 */
export function agentHeader(name: string, skills: string[]): string {
	const skillStr: string = skills.join(", ");
	const label: string = ` ${name} `;
	const suffix: string = ` ${skillStr} `;
	const fillLen: number = TERM_WIDTH - label.length - suffix.length - 4;
	const fill: string = "─".repeat(Math.max(2, fillLen));
	return chalk.bold(`\n── ${name} ${chalk.dim(`${fill} ${skillStr}`)} ──`);
}

/**
 * Formats token usage, cost, and duration stats for a single agent response.
 * @param usage - Input and output token counts.
 * @param durationMs - LLM call duration in milliseconds.
 * @param model - Model identifier used for pricing lookup.
 * @returns Formatted stats string.
 */
export function agentStats(
	usage: { inputTokens: number; outputTokens: number },
	durationMs: number,
	model: string,
): string {
	const tokens: string = `${usage.inputTokens} in · ${usage.outputTokens} out tokens`;
	const duration: string = `${(durationMs / 1000).toFixed(1)}s`;

	const pricing = PRICING[model];
	if (pricing) {
		const cost: number =
			(usage.inputTokens * pricing.input +
				usage.outputTokens * pricing.output) /
			1_000_000;
		return chalk.dim(`  ${tokens}  |  $${cost.toFixed(4)}  |  ${duration}`);
	}

	return chalk.dim(`  ${tokens}  |  ${duration}`);
}

/**
 * Renders a summary block showing aggregate stats across all agent responses.
 * @param results - Array of agent results to summarize.
 * @returns Formatted multi-line summary string.
 */
export function summaryBlock(results: AgentResult[]): string {
	const totalIn: number = results.reduce(
		(s: number, r: AgentResult) => s + r.usage.inputTokens,
		0,
	);
	const totalOut: number = results.reduce(
		(s: number, r: AgentResult) => s + r.usage.outputTokens,
		0,
	);
	const totalMs: number = results.reduce(
		(s: number, r: AgentResult) => s + r.durationMs,
		0,
	);

	const model: string = results[0]?.model ?? "";
	const pricing = PRICING[model];

	const agents: string = `${results.length} agents`;
	const tokens: string = `${totalIn} in · ${totalOut} out tokens`;
	const duration: string = `${(totalMs / 1000).toFixed(1)}s`;

	let inner: string;
	if (pricing) {
		const cost: number =
			(totalIn * pricing.input + totalOut * pricing.output) / 1_000_000;
		inner = `${agents}  |  ${tokens}  |  $${cost.toFixed(4)}  |  ${duration}`;
	} else {
		inner = `${agents}  |  ${tokens}  |  ${duration}`;
	}

	const label: string = " Summary ";
	const padLen: number = Math.max(0, TERM_WIDTH - label.length - 2);
	const left: number = Math.floor(padLen / 2);
	const right: number = padLen - left;
	const topLine: string = `${"─".repeat(left)}${label}${"─".repeat(right)}`;
	const botLine: string = "─".repeat(TERM_WIDTH);

	return [
		"",
		chalk.dim(topLine),
		chalk.dim(`  ${inner}`),
		chalk.dim(botLine),
	].join("\n");
}

/**
 * Returns a horizontal separator line spanning the terminal width.
 * @returns Dimmed separator string.
 */
export function separator(): string {
	return chalk.dim("─".repeat(TERM_WIDTH));
}

const SPINNER_FRAMES: string[] = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

/**
 * Creates an animated terminal spinner with the given text.
 * @param text - Label to display next to the spinner.
 * @returns Object with a `stop()` method to clear the spinner.
 */
export function createSpinner(text: string): { stop: () => void } {
	let i: number = 0;
	const id: ReturnType<typeof setInterval> = setInterval(() => {
		const frame: string = SPINNER_FRAMES[i % SPINNER_FRAMES.length];
		process.stdout.write(`\r${chalk.cyan(frame)} ${chalk.dim(text)}`);
		i++;
	}, 80);

	return {
		stop(): void {
			clearInterval(id);
			process.stdout.write(`\r${" ".repeat(text.length + 4)}\r`);
		},
	};
}
