import type {
	AgentProbeResult,
	AgentTerminalState,
	AssertionDetail,
	AssertionResult,
	ProbeExpect,
} from "./types.ts";

export function checkAssertions(
	expect: ProbeExpect,
	agents: AgentProbeResult[],
	supportsRouting: boolean = true,
	terminalStates?: AgentTerminalState[],
): AssertionResult {
	const details: AssertionDetail[] = [];

	// Agent count checks
	if (expect.agentCount?.min != null) {
		const passed = agents.length >= expect.agentCount.min;
		details.push({
			name: "agentCount.min",
			passed,
			status: passed ? "pass" : "fail",
			expected: `>= ${expect.agentCount.min}`,
			actual: String(agents.length),
		});
	}
	if (expect.agentCount?.max != null) {
		if (!supportsRouting) {
			details.push({
				name: "agentCount.max",
				passed: true,
				status: "na",
				expected: `<= ${expect.agentCount.max}`,
				actual: String(agents.length),
				reason: "protocol does not support routing; broadcast to all agents",
			});
		} else {
			const passed = agents.length <= expect.agentCount.max;
			details.push({
				name: "agentCount.max",
				passed,
				status: passed ? "pass" : "fail",
				expected: `<= ${expect.agentCount.max}`,
				actual: String(agents.length),
			});
		}
	}

	// Required skills: at least one responding agent must have each required skill
	if (expect.requiredSkills) {
		for (const skill of expect.requiredSkills) {
			const found = agents.some((a) =>
				a.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase())),
			);
			details.push({
				name: `requiredSkill:${skill}`,
				passed: found,
				status: found ? "pass" : "fail",
				expected: `at least one agent with "${skill}"`,
				actual: found
					? agents
							.filter((a) =>
								a.skills.some((s) =>
									s.toLowerCase().includes(skill.toLowerCase()),
								),
							)
							.map((a) => a.agentName)
							.join(", ")
					: "none",
			});
		}
	}

	// Excluded skills: no responding agent should have these
	if (expect.excludedSkills) {
		for (const skill of expect.excludedSkills) {
			if (!supportsRouting) {
				const violators = agents.filter((a) =>
					a.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase())),
				);
				details.push({
					name: `excludedSkill:${skill}`,
					passed: true,
					status: "na",
					expected: `no agents with "${skill}"`,
					actual:
						violators.length > 0
							? violators.map((a) => a.agentName).join(", ")
							: "none",
					reason: "protocol does not support routing; broadcast to all agents",
				});
			} else {
				const violators = agents.filter((a) =>
					a.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase())),
				);
				const passed = violators.length === 0;
				details.push({
					name: `excludedSkill:${skill}`,
					passed,
					status: passed ? "pass" : "fail",
					expected: `no agents with "${skill}"`,
					actual:
						violators.length > 0
							? violators.map((a) => a.agentName).join(", ")
							: "none (good)",
				});
			}
		}
	}

	// Decline-all pattern: reward explicit declines, penalize silent timeouts
	if (expect.agentCount?.max === 0 && terminalStates) {
		const decliners = terminalStates.filter(
			(s) => s.status === "declined",
		).length;
		const timeouts = terminalStates.filter(
			(s) => s.status === "timed-out",
		).length;
		const passed = decliners > 0 || timeouts === 0;
		details.push({
			name: "decline-cleanly",
			passed,
			status: passed ? "pass" : "fail",
			expected: "at least one explicit decline OR zero silent timeouts",
			actual: `${decliners} declined, ${timeouts} timed out`,
		});
	}

	return {
		passed: details.every((d) => d.status !== "fail"),
		details,
	};
}
