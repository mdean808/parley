import type {
	AgentProbeResult,
	AssertionDetail,
	AssertionResult,
	ProbeExpect,
} from "./types.ts";

export function checkAssertions(
	expect: ProbeExpect,
	agents: AgentProbeResult[],
): AssertionResult {
	const details: AssertionDetail[] = [];

	// Agent count checks
	if (expect.agentCount?.min != null) {
		details.push({
			name: "agentCount.min",
			passed: agents.length >= expect.agentCount.min,
			expected: `>= ${expect.agentCount.min}`,
			actual: String(agents.length),
		});
	}
	if (expect.agentCount?.max != null) {
		details.push({
			name: "agentCount.max",
			passed: agents.length <= expect.agentCount.max,
			expected: `<= ${expect.agentCount.max}`,
			actual: String(agents.length),
		});
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
			const violators = agents.filter((a) =>
				a.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase())),
			);
			details.push({
				name: `excludedSkill:${skill}`,
				passed: violators.length === 0,
				expected: `no agents with "${skill}"`,
				actual:
					violators.length > 0
						? violators.map((a) => a.agentName).join(", ")
						: "none (good)",
			});
		}
	}

	return {
		passed: details.every((d) => d.passed),
		details,
	};
}
