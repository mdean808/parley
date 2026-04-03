import chalk from "chalk";
import { evaluateScenario } from "./src/bench/judge.ts";
import type { JudgeConfig } from "./src/bench/judge-types.ts";
import { runScenario } from "./src/bench/runner.ts";
import {
	DEFAULT_SCENARIOS,
	MULTI_ROUND_SCENARIOS,
} from "./src/bench/scenarios.ts";
import type { BenchmarkOutput, ProtocolRunResult } from "./src/bench/types.ts";
import { MODEL } from "./src/config.ts";
import { createProtocol, type ProtocolId } from "./src/factory.ts";

if (!process.env.ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
	process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
let outputPath = "results/benchmark.json";
let protocols: ProtocolId[] = ["v1", "v2", "simple"];
let judgeEnabled = true;
let judgeModel: string | undefined;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--protocols" && args[i + 1]) {
		protocols = args[i + 1].split(",") as ProtocolId[];
		i++;
	} else if (args[i] === "--output" && args[i + 1]) {
		outputPath = args[i + 1];
		i++;
	} else if (args[i] === "--no-judge") {
		judgeEnabled = false;
	} else if (args[i] === "--judge") {
		judgeEnabled = true;
	} else if (args[i] === "--judge-model" && args[i + 1]) {
		judgeModel = args[i + 1];
		i++;
	}
}

const judgeConfig: JudgeConfig = {
	enabled: judgeEnabled,
	model: judgeModel,
};

const scenarios = [...DEFAULT_SCENARIOS, ...MULTI_ROUND_SCENARIOS];
const allResults: ProtocolRunResult[] = [];

console.log(chalk.bold("\nBenchmark Runner\n"));
console.log(`Model: ${chalk.cyan(MODEL)}`);
console.log(`Protocols: ${chalk.cyan(protocols.join(", "))}`);
console.log(`Scenarios: ${chalk.cyan(String(scenarios.length))}`);
console.log(`Judge: ${chalk.cyan(judgeEnabled ? "enabled" : "disabled")}\n`);

for (const scenario of scenarios) {
	for (const protocolId of protocols) {
		const label = `[${scenario.name}] ${protocolId}`;
		process.stdout.write(chalk.dim(`  ${label}... `));

		const protocol = createProtocol(protocolId);
		const result = await runScenario(protocol, protocolId, scenario);

		// Run judge evaluation
		if (judgeConfig.enabled) {
			process.stdout.write(chalk.dim("judging... "));
			const roundData = result.rounds.map((r) => ({
				userMessage: r.prompt,
				results: r.agents.map((a) => ({
					agentName: a.agentName,
					skills: a.skills,
					response: {
						id: "",
						chainId: "",
						replyTo: undefined,
						timestamp: "",
						type: "RESPONSE" as const,
						payload: a.responseText,
						from: a.agentName.toLowerCase(),
						to: [] as string[],
					},
					usage: { inputTokens: a.inputTokens, outputTokens: a.outputTokens },
					model: a.model,
					durationMs: a.durationMs,
				})),
			}));
			result.judge = await evaluateScenario(roundData, judgeConfig);
		}

		allResults.push(result);

		const dur = (result.aggregate.totalDurationMs / 1000).toFixed(1);
		const judgeStr = result.judge
			? ` judge: ${result.judge.aggregate.overall.toFixed(1)}`
			: "";
		console.log(chalk.green(`done`) + chalk.dim(` (${dur}s${judgeStr})`));
	}
}

// Write JSON output
const output: BenchmarkOutput = {
	timestamp: new Date().toISOString(),
	model: MODEL,
	scenarios: allResults,
};

await Bun.write(outputPath, JSON.stringify(output, null, 2));
console.log(chalk.dim(`\nResults written to ${outputPath}\n`));

// Print summary table
const hasJudge = allResults.some((r) => r.judge);

const colWidths = {
	protocol: 10,
	scenario: 24,
	rounds: 8,
	agents: 14,
	tokens: 20,
	cost: 10,
	duration: 10,
	judge: 8,
};

const headerCols = [
	"Protocol".padEnd(colWidths.protocol),
	"Scenario".padEnd(colWidths.scenario),
	"Rounds".padEnd(colWidths.rounds),
	"Agents/Round".padEnd(colWidths.agents),
	"Tokens (in/out)".padEnd(colWidths.tokens),
	"Cost".padEnd(colWidths.cost),
	"Duration".padEnd(colWidths.duration),
];
if (hasJudge) headerCols.push("Judge".padEnd(colWidths.judge));

const header = headerCols.join(" | ");
console.log(chalk.bold(header));
console.log(chalk.dim("─".repeat(header.length)));

for (const r of allResults) {
	const a = r.aggregate;
	const rowCols = [
		r.protocolId.padEnd(colWidths.protocol),
		r.scenarioName.padEnd(colWidths.scenario),
		String(a.roundCount).padEnd(colWidths.rounds),
		a.averageAgentsPerRound.toFixed(1).padEnd(colWidths.agents),
		`${a.totalInputTokens} / ${a.totalOutputTokens}`.padEnd(colWidths.tokens),
		`$${a.totalCost.toFixed(4)}`.padEnd(colWidths.cost),
		`${(a.totalDurationMs / 1000).toFixed(1)}s`.padEnd(colWidths.duration),
	];
	if (hasJudge) {
		const score = r.judge?.aggregate.overall.toFixed(1) ?? "—";
		rowCols.push(score.padEnd(colWidths.judge));
	}
	console.log(rowCols.join(" | "));
}

console.log("");
