import chalk from "chalk";
import type { ComparisonReport, OverheadMetrics } from "./comparison.ts";

function pad(str: string, len: number): string {
	return str.padEnd(len);
}

function fmtNum(n: number): string {
	return n.toLocaleString("en-US");
}

function fmtPct(n: number): string {
	const sign = n >= 0 ? "+" : "";
	return `${sign}${n.toFixed(1)}%`;
}

function fmtOverhead(n: number): string {
	const sign = n >= 0 ? "+" : "";
	return `${sign}${fmtNum(Math.round(n))}`;
}

export function printTerminalReport(report: ComparisonReport): void {
	const { protocolIds, baseline } = report;

	console.log(chalk.bold("\n=== Protocol Comparison Report ===\n"));
	console.log(`Model: ${chalk.cyan(report.model)}`);
	console.log(`Generated: ${chalk.dim(report.generatedAt)}`);
	console.log(`Scenarios: ${chalk.cyan(String(report.scenarios.length))}`);
	console.log(`Baseline: ${chalk.cyan(baseline)}\n`);

	// Protocol Summary Table
	console.log(chalk.bold("Protocol Summary"));
	const cols = [12, 12, 13, 10, 10, 10];
	const hdr = [
		pad("Protocol", cols[0]),
		pad("Input Tok", cols[1]),
		pad("Output Tok", cols[2]),
		pad("Cost", cols[3]),
		pad("Duration", cols[4]),
		pad("Judge", cols[5]),
	].join(" | ");
	console.log(hdr);
	console.log(chalk.dim("─".repeat(hdr.length)));

	for (const pid of protocolIds) {
		let totalIn = 0;
		let totalOut = 0;
		let totalCost = 0;
		let totalDur = 0;
		let judgeSum = 0;
		let judgeCount = 0;

		for (const sc of report.scenarios) {
			const r = sc.results[pid];
			totalIn += r.aggregate.totalInputTokens;
			totalOut += r.aggregate.totalOutputTokens;
			totalCost += r.aggregate.totalCost;
			totalDur += r.aggregate.totalDurationMs;
			if (r.judge) {
				judgeSum += r.judge.aggregate.overall;
				judgeCount++;
			}
		}

		const judgeAvg = judgeCount > 0 ? (judgeSum / judgeCount).toFixed(1) : "—";
		const row = [
			pad(pid, cols[0]),
			pad(fmtNum(totalIn), cols[1]),
			pad(fmtNum(totalOut), cols[2]),
			pad(`$${totalCost.toFixed(4)}`, cols[3]),
			pad(`${(totalDur / 1000).toFixed(1)}s`, cols[4]),
			pad(judgeAvg, cols[5]),
		].join(" | ");
		console.log(row);
	}

	// Overhead Table (non-baseline protocols vs baseline)
	const nonBaseline = protocolIds.filter((p) => p !== baseline);
	if (nonBaseline.length > 0) {
		console.log(chalk.bold(`\nOverhead vs ${baseline}`));
		const oCols = [12, 14, 15, 12, 12];
		const oHdr = [
			pad(`vs ${baseline}`, oCols[0]),
			pad("+Input Tok", oCols[1]),
			pad("+Output Tok", oCols[2]),
			pad("+Cost", oCols[3]),
			pad("+Duration", oCols[4]),
		].join(" | ");
		console.log(oHdr);
		console.log(chalk.dim("─".repeat(oHdr.length)));

		function printOverheadRow(label: string, o: OverheadMetrics): void {
			const row = [
				pad(label, oCols[0]),
				pad(fmtOverhead(o.extraInputTokens), oCols[1]),
				pad(fmtOverhead(o.extraOutputTokens), oCols[2]),
				pad(
					`$${(o.extraInputTokens * 0 + o.extraOutputTokens * 0).toFixed(4)}`,
					oCols[3],
				),
				pad(`${(o.extraDurationMs / 1000).toFixed(1)}s`, oCols[4]),
			].join(" | ");
			console.log(row);

			const pctRow = [
				pad("", oCols[0]),
				pad(`(${fmtPct(o.extraInputPercent)})`, oCols[1]),
				pad(`(${fmtPct(o.extraOutputPercent)})`, oCols[2]),
				pad("", oCols[3]),
				pad(`(${fmtPct(o.extraDurationPercent)})`, oCols[4]),
			].join(" | ");
			console.log(chalk.dim(pctRow));
		}

		for (const pid of nonBaseline) {
			printOverheadRow(pid, report.aggregate.avgOverhead[pid]);
		}
	}

	// Per-Scenario Judge Scores
	const hasJudge = report.scenarios.some((sc) =>
		Object.values(sc.results).some((r) => r.judge),
	);

	if (hasJudge) {
		console.log(chalk.bold("\nPer-Scenario Judge Scores"));
		const colWidth = 8;
		const sCols = [24, ...protocolIds.map(() => colWidth), 6];
		const sHdr = [
			pad("Scenario", sCols[0]),
			...protocolIds.map((pid, i) => pad(pid, sCols[i + 1])),
			pad("Best", sCols[sCols.length - 1]),
		].join(" | ");
		console.log(sHdr);
		console.log(chalk.dim("─".repeat(sHdr.length)));

		for (const sc of report.scenarios) {
			const scores: Record<string, number> = {};
			for (const pid of protocolIds) {
				scores[pid] = sc.results[pid]?.judge?.aggregate.overall ?? 0;
			}

			const best = Object.entries(scores).reduce((a, b) =>
				b[1] > a[1] ? b : a,
			)[0];

			const row = [
				pad(sc.scenario.name, sCols[0]),
				...protocolIds.map((pid, i) =>
					pad(scores[pid].toFixed(1), sCols[i + 1]),
				),
				pad(best, sCols[sCols.length - 1]),
			].join(" | ");
			console.log(row);
		}
	}

	console.log("");
}
