import chalk from "chalk";
import { runComparison } from "./comparison.ts";
import type { JudgeConfig } from "./judge-types.ts";
import { generateMarkdownReport } from "./report-markdown.ts";
import { printTerminalReport } from "./report-terminal.ts";
import { MODEL } from "core/config";

if (!process.env.ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
	process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
let scenarioIds: string[] | undefined;
let categories: string[] | undefined;
let protocolIds: string[] | undefined;
let baseline: string | undefined;
let outputDir = new URL("../results", import.meta.url).pathname;
let judgeEnabled = true;
let judgeModel: string | undefined;
let noReport = false;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--protocols" && args[i + 1]) {
		protocolIds = args[i + 1].split(",");
		i++;
	} else if (args[i] === "--scenarios" && args[i + 1]) {
		scenarioIds = args[i + 1].split(",");
		i++;
	} else if (args[i] === "--category" && args[i + 1]) {
		categories = args[i + 1].split(",");
		i++;
	} else if (args[i] === "--baseline" && args[i + 1]) {
		baseline = args[i + 1];
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
if (baseline) console.log(`Baseline: ${chalk.cyan(baseline)}`);
if (scenarioIds)
	console.log(`Scenarios: ${chalk.cyan(scenarioIds.join(", "))}`);
else if (categories)
	console.log(`Categories: ${chalk.cyan(categories.join(", "))}`);
else console.log(`Scenarios: ${chalk.cyan("all")}`);
console.log(`Judge: ${chalk.cyan(judgeEnabled ? "enabled" : "disabled")}\n`);

const report = await runComparison({
	scenarios: scenarioIds,
	categories,
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

// Write JSON + optionally Markdown
const timestamp = new Date().toISOString().split("T")[0];
const jsonPath = `${outputDir}/benchmark-${timestamp}.json`;
await Bun.write(jsonPath, JSON.stringify(report, null, 2));
console.log(chalk.dim(`Results written to: ${jsonPath}`));

if (!noReport) {
	const mdPath = `${outputDir}/benchmark-${timestamp}.md`;
	await Bun.write(mdPath, generateMarkdownReport(report));
	console.log(chalk.dim(`Report written to: ${mdPath}`));
}

console.log("");
