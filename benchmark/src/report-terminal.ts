import chalk from "chalk";
import type { ComparisonReport } from "./comparison.ts";

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function pad(str: string, len: number): string {
	const visibleLen = stripAnsi(str).length;
	const padding = Math.max(0, len - visibleLen);
	return str + " ".repeat(padding);
}

function fmtNum(n: number): string {
	return n.toLocaleString("en-US");
}

export function printTerminalReport(report: ComparisonReport): void {
	const { protocolIds } = report;

	console.log(chalk.bold("\n=== Protocol Comparison Report ===\n"));
	console.log(`Model: ${chalk.cyan(report.model)}`);
	console.log(`Generated: ${chalk.dim(report.generatedAt)}`);
	console.log(`Scenarios: ${chalk.cyan(String(report.scenarios.length))}`);
	if (report.baseline) console.log(`Baseline: ${chalk.cyan(report.baseline)}`);
	console.log("");

	// Protocol Summary Table
	console.log(chalk.bold("Protocol Summary"));
	const cols = [12, 12, 10, 14, 12, 12, 12];
	const hdr = [
		pad("Protocol", cols[0]),
		pad("Success", cols[1]),
		pad("Quality", cols[2]),
		pad("Tok/Success", cols[3]),
		pad("Cost/Success", cols[4]),
		pad("Coord.Eff", cols[5]),
		pad("Multi-Agent", cols[6]),
	].join(" | ");
	console.log(hdr);
	console.log(chalk.dim("─".repeat(hdr.length)));

	const metrics = report.aggregate.protocolMetrics;
	for (const pid of protocolIds) {
		const m = metrics[pid];
		if (!m) continue;

		const successLabel = `${m.passedCount}/${m.totalCount} (${m.successRate.toFixed(0)}%)`;
		const quality = m.avgQuality > 0 ? m.avgQuality.toFixed(1) : "—";
		const tokPerSuccess =
			m.passedCount > 0 ? fmtNum(Math.round(m.avgTokensPerSuccess)) : "—";
		const costPerSuccess =
			m.passedCount > 0 ? `$${m.avgCostPerSuccess.toFixed(4)}` : "—";
		const coordEff = m.avgCoordinationEfficiency.toFixed(3);
		const multiAgent = m.avgMultiAgentContribution.toFixed(2);

		const row = [
			pad(pid, cols[0]),
			pad(successLabel, cols[1]),
			pad(quality, cols[2]),
			pad(tokPerSuccess, cols[3]),
			pad(costPerSuccess, cols[4]),
			pad(coordEff, cols[5]),
			pad(multiAgent, cols[6]),
		].join(" | ");
		console.log(row);
	}

	// Per-Scenario Results
	const hasJudge = report.scenarios.some((sc) =>
		Object.values(sc.results).some((r) => r.judge),
	);

	if (hasJudge) {
		console.log(chalk.bold("\nPer-Scenario Results"));
		const colWidth = 14;
		const sCols = [24, ...protocolIds.map(() => colWidth)];
		const sHdr = [
			pad("Scenario", sCols[0]),
			...protocolIds.map((pid, i) => pad(pid, sCols[i + 1])),
		].join(" | ");
		console.log(sHdr);
		console.log(chalk.dim("─".repeat(sHdr.length)));

		for (const sc of report.scenarios) {
			const vals = protocolIds.map((pid, i) => {
				const r = sc.results[pid];
				if (!r) return pad("—", sCols[i + 1]);
				if (r.error) return pad(chalk.red("ERR"), sCols[i + 1]);
				if (!r.metrics) return pad("—", sCols[i + 1]);
				if (r.metrics.passed) {
					const q = r.judge?.aggregate.qualityScore;
					const ea = r.judge?.aggregate.expectationAlignment;
					const parts = [
						q ? q.toFixed(1) : null,
						ea ? `E:${ea.toFixed(1)}` : null,
					].filter(Boolean);
					const label = parts.length > 0 ? `PASS (${parts.join(" ")})` : "PASS";
					return pad(chalk.green(label), sCols[i + 1]);
				}
				return pad(chalk.red("FAIL"), sCols[i + 1]);
			});

			const row = [pad(sc.scenario.name, sCols[0]), ...vals].join(" | ");
			console.log(row);
		}
	}

	// Error Summary
	const errors: { scenario: string; protocol: string; error: string }[] = [];
	for (const sc of report.scenarios) {
		for (const pid of protocolIds) {
			const r = sc.results[pid];
			if (r?.error) {
				errors.push({
					scenario: sc.scenario.name,
					protocol: pid,
					error: r.error,
				});
			}
		}
	}
	if (errors.length > 0) {
		console.log(chalk.bold.red(`\nErrors (${errors.length})`));
		for (const e of errors) {
			console.log(chalk.red(`  ${e.scenario} / ${e.protocol}: ${e.error}`));
		}
	}

	console.log("");
}
