import chalk from "chalk";
import { MODEL } from "core/config";
import { runComparison } from "./comparison.ts";
import type { JudgeConfig } from "./judge-types.ts";
import { generateMarkdownReport } from "./report-markdown.ts";
import { printTerminalReport } from "./report-terminal.ts";
import type { InteractionPattern } from "./types.ts";

if (!process.env.ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
	process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
let probeIds: string[] | undefined;
let patterns: InteractionPattern[] | undefined;
let protocolIds: string[] | undefined;
let outputDir = new URL("../results", import.meta.url).pathname;
let judgeEnabled = true;
let judgeModel: string | undefined;
let noReport = false;
let concurrency = 3;

const KNOWN_FLAGS = new Set([
	"--protocols",
	"--probes",
	"--pattern",
	"--output",
	"--no-judge",
	"--judge",
	"--judge-model",
	"--no-report",
	"--concurrency",
]);
const VALUE_FLAGS = new Set([
	"--protocols",
	"--probes",
	"--pattern",
	"--output",
	"--judge-model",
	"--concurrency",
]);

const VALID_PATTERNS: Set<string> = new Set([
	"single-route",
	"selective-route",
	"decline-all",
	"handoff",
	"collaborate",
]);

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--protocols" && args[i + 1]) {
		protocolIds = args[i + 1].split(",");
		i++;
	} else if (args[i] === "--probes" && args[i + 1]) {
		probeIds = args[i + 1].split(",");
		i++;
	} else if (args[i] === "--pattern" && args[i + 1]) {
		const raw = args[i + 1].split(",");
		for (const p of raw) {
			if (!VALID_PATTERNS.has(p)) {
				console.error(
					`Error: Unknown pattern "${p}". Valid: ${[...VALID_PATTERNS].join(", ")}`,
				);
				process.exit(1);
			}
		}
		patterns = raw as InteractionPattern[];
		i++;
	} else if (args[i] === "--output" && args[i + 1]) {
		outputDir = args[i + 1];
		i++;
	} else if (args[i] === "--no-judge") {
		judgeEnabled = false;
	} else if (args[i] === "--judge") {
		judgeEnabled = true;
	} else if (args[i] === "--judge-model" && args[i + 1]) {
		judgeModel = args[i + 1];
		i++;
	} else if (args[i] === "--no-report") {
		noReport = true;
	} else if (args[i] === "--concurrency" && args[i + 1]) {
		concurrency = Math.max(1, Number.parseInt(args[i + 1], 10) || 3);
		i++;
	} else if (KNOWN_FLAGS.has(args[i]) && VALUE_FLAGS.has(args[i])) {
		console.error(`Error: Flag "${args[i]}" requires a value.`);
		process.exit(1);
	} else if (args[i].startsWith("--")) {
		console.error(`Error: Unknown flag "${args[i]}".`);
		console.error(`Known flags: ${[...KNOWN_FLAGS].join(", ")}`);
		process.exit(1);
	} else {
		console.error(`Error: Unexpected argument "${args[i]}".`);
		process.exit(1);
	}
}

const judgeConfig: JudgeConfig = {
	enabled: judgeEnabled,
	model: judgeModel,
};

console.log(chalk.bold("\nBenchmark Runner\n"));
console.log(`Model: ${chalk.cyan(MODEL)}`);
console.log(
	`Protocols: ${chalk.cyan(protocolIds ? protocolIds.join(", ") : "all registered")}`,
);
if (probeIds) console.log(`Probes: ${chalk.cyan(probeIds.join(", "))}`);
else if (patterns) console.log(`Patterns: ${chalk.cyan(patterns.join(", "))}`);
else console.log(`Probes: ${chalk.cyan("all")}`);
console.log(`Judge: ${chalk.cyan(judgeEnabled ? "enabled" : "disabled")}`);
console.log(`Concurrency: ${chalk.cyan(String(concurrency))}\n`);

// Progress display
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface TaskDisplay {
	probeId: string;
	protocolId: string;
	status: "running" | "judging" | "done" | "error";
	durationMs?: number;
}

const taskDisplays: TaskDisplay[] = [];
const taskMap = new Map<string, number>();
let spinnerFrame = 0;
let displayLines = 0;
let totalTasks = 0;
let completedTasks = 0;

const effectiveJudgeModel = (
	judgeModel ??
	process.env.JUDGE_MODEL ??
	"claude-sonnet-4-6"
)
	.replace("claude-", "")
	.replace(/-\d{8}$/, "");
const shortAgentModel = MODEL.replace("claude-", "").replace(/-\d{8}$/, "");

function renderProgress() {
	if (displayLines > 0) {
		process.stdout.write(`\x1b[${displayLines}A`);
	}

	let lines = 0;

	for (const task of taskDisplays) {
		let icon: string;
		let status: string;

		switch (task.status) {
			case "done": {
				icon = chalk.green("✓");
				const dur =
					task.durationMs != null
						? ` (${(task.durationMs / 1000).toFixed(1)}s)`
						: "";
				status = chalk.green("done") + chalk.dim(dur);
				break;
			}
			case "error": {
				icon = chalk.red("✗");
				const dur =
					task.durationMs != null
						? ` (${(task.durationMs / 1000).toFixed(1)}s)`
						: "";
				status = chalk.red("error") + chalk.dim(dur);
				break;
			}
			case "running":
				icon = chalk.cyan(SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]);
				status = chalk.cyan("agents") + chalk.dim(` · ${shortAgentModel}`);
				break;
			case "judging":
				icon = chalk.yellow(
					SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length],
				);
				status = chalk.yellow("judge") + chalk.dim(` · ${effectiveJudgeModel}`);
				break;
		}

		process.stdout.write(
			`\x1b[K  ${icon} ${task.probeId} ${chalk.dim("/")} ${task.protocolId} ${chalk.dim("—")} ${status}\n`,
		);
		lines++;
	}

	if (totalTasks > 0) {
		process.stdout.write(
			`\x1b[K  ${chalk.dim(`${completedTasks}/${totalTasks} complete`)}\n`,
		);
		lines++;
	}

	displayLines = lines;
	spinnerFrame++;
}

const spinnerInterval = setInterval(renderProgress, 80);

const report = await runComparison({
	probes: probeIds,
	patterns,
	protocols: protocolIds,
	judgeConfig,
	concurrency,
	onProgress: (event) => {
		const key = `${event.probeId}::${event.protocolId}`;
		switch (event.type) {
			case "start": {
				totalTasks = event.totalTasks;
				taskDisplays.push({
					probeId: event.probeId,
					protocolId: event.protocolId,
					status: "running",
				});
				taskMap.set(key, taskDisplays.length - 1);
				break;
			}
			case "phase": {
				const idx = taskMap.get(key);
				if (idx != null) {
					taskDisplays[idx].status =
						event.phase === "judge" ? "judging" : "running";
				}
				break;
			}
			case "complete": {
				const idx = taskMap.get(key);
				if (idx != null) {
					taskDisplays[idx].status = event.error ? "error" : "done";
					taskDisplays[idx].durationMs = event.durationMs;
				}
				completedTasks++;
				break;
			}
		}
	},
});

clearInterval(spinnerInterval);
renderProgress();
process.stdout.write("\n");

// Print terminal report
printTerminalReport(report);

// Write JSON + optionally Markdown
const timestamp = new Date()
	.toISOString()
	.replace(/:/g, "-")
	.replace(/\.\d+Z$/, "");
const jsonPath = `${outputDir}/benchmark-${timestamp}.json`;
await Bun.write(jsonPath, JSON.stringify(report, null, 2));
console.log(chalk.dim(`Results written to: ${jsonPath}`));

if (!noReport) {
	const mdPath = `${outputDir}/benchmark-${timestamp}.md`;
	await Bun.write(mdPath, generateMarkdownReport(report));
	console.log(chalk.dim(`Report written to: ${mdPath}`));
}

console.log("");
process.exit(0);
