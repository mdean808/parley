import chalk from "chalk";
import { runComparison } from "./src/bench/comparison.ts";
import type { JudgeConfig } from "./src/bench/judge-types.ts";
import { generateMarkdownReport } from "./src/bench/report-markdown.ts";
import { printTerminalReport } from "./src/bench/report-terminal.ts";
import { MODEL } from "./src/config.ts";

if (!process.env.ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
	process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
let scenarioIds: string[] | undefined;
let protocolIds: string[] | undefined;
let baseline: string | undefined;
let outputDir = "results";
let judgeEnabled = true;
let judgeModel: string | undefined;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--scenarios" && args[i + 1]) {
		scenarioIds = args[i + 1].split(",");
		i++;
	} else if (args[i] === "--protocols" && args[i + 1]) {
		protocolIds = args[i + 1].split(",");
		i++;
	} else if (args[i] === "--baseline" && args[i + 1]) {
		baseline = args[i + 1];
		i++;
	} else if (args[i] === "--output" && args[i + 1]) {
		outputDir = args[i + 1];
		i++;
	} else if (args[i] === "--model" && args[i + 1]) {
		// Model is set via env var; note for user
		console.log(
			chalk.yellow(
				`Note: Set MODEL env var to change agent model. --model flag noted but MODEL env var takes precedence.`,
			),
		);
		i++;
	} else if (args[i] === "--no-judge") {
		judgeEnabled = false;
	} else if (args[i] === "--judge-model" && args[i + 1]) {
		judgeModel = args[i + 1];
		i++;
	}
}

const judgeConfig: JudgeConfig = {
	enabled: judgeEnabled,
	model: judgeModel,
};

console.log(chalk.bold("\nRunning comparison benchmarks...\n"));
console.log(`Model: ${chalk.cyan(MODEL)}`);
console.log(
	`Protocols: ${chalk.cyan(protocolIds ? protocolIds.join(", ") : "all registered")}`,
);
if (baseline) console.log(`Baseline: ${chalk.cyan(baseline)}`);
console.log(
	`Scenarios: ${chalk.cyan(scenarioIds ? scenarioIds.join(", ") : "all")}`,
);
console.log(`Judge: ${chalk.cyan(judgeEnabled ? "enabled" : "disabled")}\n`);

const report = await runComparison({
	scenarios: scenarioIds,
	protocols: protocolIds,
	baseline,
	outputDir,
	judgeConfig,
	onProgress: (msg) => {
		process.stdout.write(`\r\x1b[K${chalk.dim(`  ${msg}`)}`);
	},
});

// Clear progress line
process.stdout.write("\r\x1b[K");

// Print terminal report
printTerminalReport(report);

// Write JSON + Markdown
const timestamp = new Date().toISOString().split("T")[0];
const jsonPath = `${outputDir}/comparison-${timestamp}.json`;
const mdPath = `${outputDir}/comparison-${timestamp}.md`;

await Bun.write(jsonPath, JSON.stringify(report, null, 2));
await Bun.write(mdPath, generateMarkdownReport(report));

console.log(chalk.dim(`Comparison complete. Results written to:`));
console.log(chalk.dim(`  JSON: ${jsonPath}`));
console.log(chalk.dim(`  Report: ${mdPath}\n`));
