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
	const cols = [12, 14, 10, 12];
	const hdr = [
		pad("Protocol", cols[0]),
		pad("Overall Pass", cols[1]),
		pad("Avg Score", cols[2]),
		pad("Avg Cost", cols[3]),
	].join(" | ");
	console.log(hdr);
	console.log(chalk.dim("-".repeat(stripAnsi(hdr).length)));

	for (const pid of protocolIds) {
		const m = metrics[pid];
		if (!m) continue;
		const row = [
			pad(pid, cols[0]),
			pad(
				`${m.passedCount}/${m.totalCount} (${m.overallPassRate.toFixed(0)}%)`,
				cols[1],
			),
			pad(`${m.avgInteractionScore.toFixed(1)}/3`, cols[2]),
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
			const pct = pm.overallPassRate.toFixed(0);
			const label = `${pct}% (${pm.passedCount}/${pm.probeCount})`;
			const colored =
				pm.overallPassRate >= 70
					? chalk.green(label)
					: pm.overallPassRate >= 40
						? chalk.yellow(label)
						: chalk.red(label);
			return pad(colored, protoCol);
		});
		console.log([pad(pattern, patternCol), ...vals].join(" | "));
	}

	// Failures
	const failures: { probeId: string; protocolId: string; reason: string }[] =
		[];
	for (const pc of report.probes) {
		for (const pid of protocolIds) {
			const r = pc.results[pid];
			if (!r) continue;
			if (r.error) {
				failures.push({ probeId: r.probeId, protocolId: pid, reason: r.error });
			} else if (!r.assertions.passed) {
				const failed = r.assertions.details.filter((d) => !d.passed);
				const reason = failed
					.map((d) => `${d.name}: expected ${d.expected}, got ${d.actual}`)
					.join("; ");
				failures.push({ probeId: r.probeId, protocolId: pid, reason });
			} else if (r.judge && !r.judge.pass) {
				failures.push({
					probeId: r.probeId,
					protocolId: pid,
					reason: r.judge.passReasoning,
				});
			}
		}
	}

	if (failures.length > 0) {
		console.log(chalk.bold.red(`\nFailures (${failures.length})`));
		for (const f of failures) {
			console.log(chalk.red(`  x ${f.protocolId} x ${f.probeId}: ${f.reason}`));
		}
	}

	console.log("");
}
