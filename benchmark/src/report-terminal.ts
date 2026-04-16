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

	console.log(chalk.bold("\n=== Protocol Benchmark ===\n"));
	console.log(`Model: ${chalk.cyan(report.model)}`);
	console.log(`Generated: ${chalk.dim(report.generatedAt)}`);
	console.log(`Probes: ${chalk.cyan(String(report.probes.length))}`);
	console.log("");

	// Configuration audit — surfaces model/max_tokens disparities across protocols
	if (report.configAudit?.length) {
		console.log(chalk.bold("Configuration Audit"));
		const auditCols = [12, 32, 16, 16];
		const auditHdr = [
			pad("Protocol", auditCols[0]),
			pad("Models observed", auditCols[1]),
			pad("max_tokens", auditCols[2]),
			pad("Source", auditCols[3]),
		].join(" | ");
		console.log(auditHdr);
		console.log(chalk.dim("-".repeat(stripAnsi(auditHdr).length)));
		for (const audit of report.configAudit) {
			const modelLabel = audit.models.length
				? audit.models.join(", ")
				: chalk.dim("(no responses)");
			const tokenLabel =
				audit.maxOutputTokens === "unknown"
					? chalk.dim("unknown")
					: String(audit.maxOutputTokens);
			console.log(
				[
					pad(audit.protocolId, auditCols[0]),
					pad(modelLabel, auditCols[1]),
					pad(tokenLabel, auditCols[2]),
					pad(chalk.dim(audit.source), auditCols[3]),
				].join(" | "),
			);
		}
		console.log("");
	}

	// Summary table
	const hasVariance = protocolIds.some(
		(pid) => (metrics[pid]?.scoreRateStdDev ?? 0) > 0,
	);
	console.log(chalk.bold("Protocol Summary"));
	const scoreCol = hasVariance ? 18 : 10;
	const cols = [12, scoreCol, 10, 10, 10, 11, 12, 10];
	const hdr = [
		pad("Protocol", cols[0]),
		pad(hasVariance ? "Score (±σ)" : "Score", cols[1]),
		pad("Interact", cols[2]),
		pad("Content", cols[3]),
		pad("Pass", cols[4]),
		pad("Out Tokens", cols[5]),
		pad("Avg Cost", cols[6]),
		pad("Avg Time", cols[7]),
	].join(" | ");
	console.log(hdr);
	console.log(chalk.dim("-".repeat(stripAnsi(hdr).length)));

	for (const pid of protocolIds) {
		const m = metrics[pid];
		if (!m) continue;

		const colorScore = (rate: number, stddev?: number) => {
			const label =
				stddev && stddev > 0
					? `${rate.toFixed(1)}% ±${stddev.toFixed(1)}`
					: `${rate.toFixed(1)}%`;
			return rate >= 70
				? chalk.green(label)
				: rate >= 40
					? chalk.yellow(label)
					: chalk.red(label);
		};

		const timeSec = m.avgDurationMs / 1000;
		const timeLabel =
			timeSec >= 60
				? `${(timeSec / 60).toFixed(1)}m`
				: `${timeSec.toFixed(1)}s`;
		const outTokLabel =
			m.avgOutputTokens >= 1000
				? `${(m.avgOutputTokens / 1000).toFixed(1)}k`
				: `${Math.round(m.avgOutputTokens)}`;

		const row = [
			pad(pid, cols[0]),
			pad(colorScore(m.scoreRate, m.scoreRateStdDev), cols[1]),
			pad(colorScore(m.interactionScoreRate), cols[2]),
			pad(colorScore(m.contentScoreRate), cols[3]),
			pad(`${m.passedCount}/${m.totalCount}`, cols[4]),
			pad(outTokLabel, cols[5]),
			pad(`$${m.avgCost.toFixed(4)}`, cols[6]),
			pad(timeLabel, cols[7]),
		].join(" | ");
		console.log(row);
	}
	if (hasVariance) {
		console.log(
			chalk.dim(
				`  (σ = sample standard deviation across runs; requires --runs > 1)`,
			),
		);
	}

	// Efficiency row: score per $0.01 and score per 1K output tokens
	console.log(chalk.bold("\nEfficiency (higher = more score per unit)"));
	const effCols = [12, 18, 22, 18];
	const effHdr = [
		pad("Protocol", effCols[0]),
		pad("Score / $0.01", effCols[1]),
		pad("Score / 1K out-tokens", effCols[2]),
		pad("Wire TOON/JSON", effCols[3]),
	].join(" | ");
	console.log(effHdr);
	console.log(chalk.dim("-".repeat(stripAnsi(effHdr).length)));
	for (const pid of protocolIds) {
		const m = metrics[pid];
		if (!m) continue;
		const perCent = m.avgCost > 0 ? m.scoreRate / (m.avgCost * 100) : 0;
		const perKOut =
			m.avgOutputTokens > 0 ? (m.scoreRate / m.avgOutputTokens) * 1000 : 0;
		const wireLabel =
			m.avgWireRatio != null
				? `${(m.avgWireRatio * 100).toFixed(1)}% (${Math.round(m.avgWireSamples ?? 0)} msgs)`
				: chalk.dim("—");
		console.log(
			[
				pad(pid, effCols[0]),
				pad(perCent.toFixed(2), effCols[1]),
				pad(perKOut.toFixed(2), effCols[2]),
				pad(wireLabel, effCols[3]),
			].join(" | "),
		);
	}
	if (protocolIds.some((pid) => metrics[pid]?.avgWireRatio != null)) {
		console.log(
			chalk.dim(
				`  (wire ratio = avg TOON char count ÷ JSON char count for parley store messages; lower = more compact)`,
			),
		);
	}

	// Protocol integrity (parley-only): per-chain sequence + ACK invariants
	const integrityEntries = protocolIds.filter(
		(pid) => metrics[pid]?.integrityRate != null,
	);
	if (integrityEntries.length > 0) {
		console.log(chalk.bold("\nProtocol Integrity (parley invariants)"));
		const intCols = [12, 18];
		const intHdr = [
			pad("Protocol", intCols[0]),
			pad("Integrity Pass", intCols[1]),
		].join(" | ");
		console.log(intHdr);
		console.log(chalk.dim("-".repeat(stripAnsi(intHdr).length)));
		for (const pid of integrityEntries) {
			const rate = metrics[pid]?.integrityRate ?? 0;
			const label = `${rate.toFixed(1)}%`;
			const colored =
				rate === 100
					? chalk.green(label)
					: rate >= 80
						? chalk.yellow(label)
						: chalk.red(label);
			console.log([pad(pid, intCols[0]), pad(colored, intCols[1])].join(" | "));
		}

		// Surface any violations seen across probes
		const violationList: string[] = [];
		for (const pc of report.probes) {
			for (const pid of integrityEntries) {
				const r = pc.results[pid];
				if (!r?.integrity || r.integrity.passed) continue;
				for (const v of r.integrity.violations) {
					violationList.push(
						`  ${chalk.red("!")} ${pid} / ${r.probeId}: [${v.rule}] ${v.detail}`,
					);
				}
			}
		}
		if (violationList.length > 0) {
			console.log(
				chalk.bold.red(`\nIntegrity violations (${violationList.length})`),
			);
			for (const line of violationList.slice(0, 20)) console.log(line);
			if (violationList.length > 20)
				console.log(chalk.dim(`  … and ${violationList.length - 20} more`));
		}
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
			const totalScore = pm.avgInteractionScore + pm.avgContentScore;
			const label = `${pct}% (${totalScore.toFixed(1)}/6)`;
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
			} else if (
				r.judge &&
				r.judge.interactionScore + r.judge.contentScore < 6
			) {
				const total = r.judge.interactionScore + r.judge.contentScore;
				issues.push({
					probeId: r.probeId,
					protocolId: pid,
					score: `${total}/6`,
					reason: r.judge.passReasoning,
				});
			} else if (!r.judge && !r.assertions.passed) {
				const failed = r.assertions.details.filter((d) => d.status === "fail");
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
				f.score === "ERR" || f.score === "FAIL" || f.score === "0/6"
					? chalk.red
					: chalk.yellow;
			console.log(
				color(`  x ${f.protocolId} x ${f.probeId}: ${f.score} — ${f.reason}`),
			);
		}
	}

	console.log("");
}
