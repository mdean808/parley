import type { ComparisonReport } from "./types.ts";

export function generateMarkdownReport(report: ComparisonReport): string {
	const lines: string[] = [];
	const { protocolIds } = report;
	const metrics = report.aggregate.protocolMetrics;

	lines.push("# Protocol Benchmark Report\n");
	lines.push(`*Run: ${report.generatedAt}*\n`);

	// Summary
	lines.push("## Summary\n");
	lines.push(
		`Tested ${protocolIds.length} protocol(s) across ${report.probes.length} interaction probes using model \`${report.model}\`.\n`,
	);

	// Configuration audit
	if (report.configAudit?.length) {
		lines.push("## Configuration Audit\n");
		lines.push(
			"Per-protocol model + output-token budget actually used during this run. Disparities here usually explain score gaps.\n",
		);
		lines.push("| Protocol | Models observed | max_tokens | Source | Notes |");
		lines.push("|----------|-----------------|------------|--------|-------|");
		for (const audit of report.configAudit) {
			const modelLabel = audit.models.length
				? audit.models.map((m) => `\`${m}\``).join(", ")
				: "—";
			const tokenLabel =
				audit.maxOutputTokens === "unknown"
					? "unknown"
					: String(audit.maxOutputTokens);
			const notes = audit.notes ?? "";
			lines.push(
				`| ${audit.protocolId} | ${modelLabel} | ${tokenLabel} | ${audit.source} | ${notes} |`,
			);
		}
		lines.push("");
	}

	// Protocol comparison table
	const hasVariance = protocolIds.some(
		(pid) => (metrics[pid]?.scoreRateStdDev ?? 0) > 0,
	);
	lines.push("## Protocol Comparison\n");
	lines.push(
		`| Protocol | ${hasVariance ? "Score (± σ)" : "Score"} | Interaction | Content | Pass | Runs | Avg Cost | Avg Time |`,
	);
	lines.push(
		"|----------|-------|-------------|---------|------|------|----------|----------|",
	);
	for (const pid of protocolIds) {
		const m = metrics[pid];
		const timeSec = m.avgDurationMs / 1000;
		const timeLabel =
			timeSec >= 60
				? `${(timeSec / 60).toFixed(1)}m`
				: `${timeSec.toFixed(1)}s`;
		const scoreLabel =
			m.scoreRateStdDev > 0
				? `${m.scoreRate.toFixed(1)}% ± ${m.scoreRateStdDev.toFixed(1)}`
				: `${m.scoreRate.toFixed(1)}%`;
		lines.push(
			`| ${pid} | ${scoreLabel} | ${m.interactionScoreRate.toFixed(1)}% | ${m.contentScoreRate.toFixed(1)}% | ${m.passedCount}/${m.totalCount} | ${m.runs} | $${m.avgCost.toFixed(4)} | ${timeLabel} |`,
		);
	}
	if (hasVariance) {
		lines.push("");
		lines.push(
			"*σ = sample standard deviation across all runs; enable with `--runs N > 1`.*",
		);
	}
	lines.push("");

	// Pattern breakdown
	lines.push("## Results by Pattern\n");
	const patterns = [
		"single-route",
		"selective-route",
		"decline-all",
		"handoff",
		"collaborate",
	];

	for (const pattern of patterns) {
		const hasData = protocolIds.some(
			(pid) => metrics[pid]?.byPattern[pattern]?.probeCount > 0,
		);
		if (!hasData) continue;

		lines.push(`### ${pattern}\n`);
		lines.push("| Protocol | Score | Interaction | Content | Pass | Probes |");
		lines.push("|----------|-------|-------------|---------|------|--------|");
		for (const pid of protocolIds) {
			const pm = metrics[pid]?.byPattern[pattern];
			if (!pm || pm.probeCount === 0) {
				lines.push(`| ${pid} | — | — | — | — | 0 |`);
			} else {
				const totalScore = pm.avgInteractionScore + pm.avgContentScore;
				lines.push(
					`| ${pid} | ${pm.scoreRate.toFixed(1)}% (${totalScore.toFixed(1)}/6) | ${pm.interactionScoreRate.toFixed(1)}% | ${pm.contentScoreRate.toFixed(1)}% | ${pm.passedCount}/${pm.probeCount} | ${pm.probeCount} |`,
				);
			}
		}
		lines.push("");
	}

	// Per-probe details
	lines.push("## Probe Details\n");
	for (const pc of report.probes) {
		lines.push(`### ${pc.probe.id}\n`);
		lines.push(
			`**Pattern:** ${pc.probe.pattern} | **Target skills:** ${pc.probe.targetSkills.join(", ") || "none"}\n`,
		);
		lines.push(`> ${pc.probe.prompt}\n`);

		lines.push(
			"| Protocol | Overall | Assertions | Judge | Interact | Content | Score | Agents |",
		);
		lines.push(
			"|----------|---------|-----------|-------|----------|---------|-------|--------|",
		);
		for (const pid of protocolIds) {
			const r = pc.results[pid];
			if (!r) {
				lines.push(`| ${pid} | — | — | — | — | — | — | — |`);
				continue;
			}
			if (r.error) {
				lines.push(`| ${pid} | ERR | ERR | — | — | — | — | — |`);
				continue;
			}
			const allNa =
				r.assertions.details.length > 0 &&
				r.assertions.details.every((d) => d.status === "na");
			const hasNa = r.assertions.details.some((d) => d.status === "na");
			const ineligible =
				r.assertions.details.length === 1 &&
				r.assertions.details[0].name === "eligibility" &&
				r.assertions.details[0].status === "na";
			const overall = ineligible
				? "N/A"
				: r.judge
					? r.judge.pass
						? "PASS"
						: "FAIL"
					: r.assertions.passed
						? "PASS"
						: "FAIL";
			const assertions = !r.assertions.passed
				? "FAIL"
				: allNa
					? "N/A"
					: hasNa
						? "PASS (some N/A)"
						: "PASS";
			const judge = r.judge ? (r.judge.pass ? "PASS" : "FAIL") : "—";
			const interact = r.judge ? `${r.judge.interactionScore}/3` : "—";
			const content = r.judge ? `${r.judge.contentScore}/3` : "—";
			const composite = r.judge
				? `${r.judge.interactionScore + r.judge.contentScore}/6`
				: "—";
			const agents = r.agents.map((a) => a.agentName).join(", ") || "none";
			lines.push(
				`| ${pid} | ${overall} | ${assertions} | ${judge} | ${interact} | ${content} | ${composite} | ${agents} |`,
			);
		}
		lines.push("");
	}

	lines.push("---\n*Generated by the protocol benchmark system.*\n");
	return lines.join("\n");
}
