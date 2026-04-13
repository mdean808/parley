import chalk from "chalk";
import type { ComparisonReport } from "./types.ts";

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function pad(str: string, len: number): string {
	const visibleLen = stripAnsi(str).length;
	return str + " ".repeat(Math.max(0, len - visibleLen));
}

export function printTerminalReport(report: ComparisonReport): void {
	const { protocolIds } = report;
	const metrics = report.aggregate.protocolMetrics;

	console.log(chalk.bold("\n=== Protocol Interaction Benchmark ===\n"));
	console.log(`Model: ${chalk.cyan(report.model)}`);
	console.log(`Generated: ${chalk.dim(report.generatedAt)}`);
	console.log(`Probes: ${chalk.cyan(String(report.probes.length))}`);
	console.log("");

	// Summary table
	console.log(chalk.bold("Protocol Summary"));
	const cols = [12, 10, 10, 12];
	const hdr = [
		pad("Protocol", cols[0]),
		pad("Score", cols[1]),
		pad("Pass", cols[2]),
		pad("Avg Cost", cols[3]),
	].join(" | ");
	console.log(hdr);
	console.log(chalk.dim("-".repeat(stripAnsi(hdr).length)));

	for (const pid of protocolIds) {
		const m = metrics[pid];
		if (!m) continue;
		const scoreLabel = `${m.scoreRate.toFixed(1)}%`;
		const scoreColored =
			m.scoreRate >= 70
				? chalk.green(scoreLabel)
				: m.scoreRate >= 40
					? chalk.yellow(scoreLabel)
					: chalk.red(scoreLabel);
		const row = [
			pad(pid, cols[0]),
			pad(scoreColored, cols[1]),
			pad(`${m.passedCount}/${m.totalCount}`, cols[2]),
			pad(`$${m.avgCost.toFixed(4)}`, cols[3]),
		].join(" | ");
		console.log(row);
	}

	// By-pattern breakdown
	console.log(chalk.bold("\nBy Pattern"));
	const patternCol = 16;
	const protoCol = 14;
	const pHdr = [
		pad("Pattern", patternCol),
		...protocolIds.map((pid) => pad(pid, protoCol)),
	].join(" | ");
	console.log(pHdr);
	console.log(chalk.dim("-".repeat(stripAnsi(pHdr).length)));

	const patterns = [
		"single-route",
		"selective-route",
		"decline-all",
		"handoff",
		"collaborate",
	];
	for (const pattern of patterns) {
		const vals = protocolIds.map((pid) => {
			const pm = metrics[pid]?.byPattern[pattern];
			if (!pm || pm.probeCount === 0) return pad(chalk.dim("—"), protoCol);
			const pct = pm.scoreRate.toFixed(0);
			const label = `${pct}% (${pm.avgInteractionScore.toFixed(1)}/3)`;
			const colored =
				pm.scoreRate >= 70
					? chalk.green(label)
					: pm.scoreRate >= 40
						? chalk.yellow(label)
						: chalk.red(label);
			return pad(colored, protoCol);
		});
		console.log([pad(pattern, patternCol), ...vals].join(" | "));
	}

	// Issues (partial scores + failures)
	const issues: {
		probeId: string;
		protocolId: string;
		score: string;
		reason: string;
	}[] = [];
	for (const pc of report.probes) {
		for (const pid of protocolIds) {
			const r = pc.results[pid];
			if (!r) continue;
			if (r.error) {
				issues.push({
					probeId: r.probeId,
					protocolId: pid,
					score: "ERR",
					reason: r.error,
				});
			} else if (r.judge && r.judge.interactionScore < 3) {
				issues.push({
					probeId: r.probeId,
					protocolId: pid,
					score: `${r.judge.interactionScore}/3`,
					reason: r.judge.passReasoning,
				});
			} else if (!r.judge && !r.assertions.passed) {
				const failed = r.assertions.details.filter((d) => !d.passed);
				const reason = failed
					.map((d) => `${d.name}: expected ${d.expected}, got ${d.actual}`)
					.join("; ");
				issues.push({
					probeId: r.probeId,
					protocolId: pid,
					score: "FAIL",
					reason,
				});
			}
		}
	}

	if (issues.length > 0) {
		console.log(chalk.bold.red(`\nIssues (${issues.length})`));
		for (const f of issues) {
			const color =
				f.score === "ERR" || f.score === "FAIL" || f.score === "0/3"
					? chalk.red
					: chalk.yellow;
			console.log(
				color(`  x ${f.protocolId} x ${f.probeId}: ${f.score} — ${f.reason}`),
			);
		}
	}

	console.log("");
}
