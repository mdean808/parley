import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ComparisonScenarioRound {
	message: string;
}

export interface ComparisonScenario {
	id: string;
	name: string;
	category: string;
	topic: string;
	rounds: ComparisonScenarioRound[];
}

const SCENARIOS_DIR = new URL(".", import.meta.url).pathname;

function parseScenarioFile(filePath: string): ComparisonScenario {
	const raw = readFileSync(filePath, "utf-8");
	const data = JSON.parse(raw) as ComparisonScenario;

	if (!data.id || typeof data.id !== "string") {
		throw new Error(`Scenario missing 'id': ${filePath}`);
	}
	if (!data.rounds || !Array.isArray(data.rounds) || data.rounds.length === 0) {
		throw new Error(`Scenario must have non-empty 'rounds': ${filePath}`);
	}
	for (const round of data.rounds) {
		if (!round.message || typeof round.message !== "string") {
			throw new Error(
				`Each round must have a non-empty 'message': ${filePath}`,
			);
		}
	}

	return data;
}

export function loadScenario(id: string): ComparisonScenario {
	const filePath = join(SCENARIOS_DIR, `${id}.json`);
	return parseScenarioFile(filePath);
}

export function loadAllScenarios(): ComparisonScenario[] {
	const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
	return files.map((f) => parseScenarioFile(join(SCENARIOS_DIR, f)));
}

export function loadScenariosByCategory(
	category: string,
): ComparisonScenario[] {
	return loadAllScenarios().filter((s) => s.category === category);
}
