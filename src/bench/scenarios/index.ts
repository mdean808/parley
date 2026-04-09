import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ScenarioRound {
	prompt: string;
}

export interface ScenarioMultiRound {
	rounds: number;
	followUpInstruction?: string;
	crossAgentContext?: boolean;
}

export interface Scenario {
	id: string;
	name: string;
	category: string;
	topic: string;
	rounds: ScenarioRound[];
	multiRound?: ScenarioMultiRound;
}

const SCENARIOS_DIR = new URL(".", import.meta.url).pathname;

function parseScenarioFile(filePath: string): Scenario {
	const raw = readFileSync(filePath, "utf-8");
	const data = JSON.parse(raw) as Scenario;

	if (!data.id || typeof data.id !== "string") {
		throw new Error(`Scenario missing 'id': ${filePath}`);
	}
	if (!data.rounds || !Array.isArray(data.rounds) || data.rounds.length === 0) {
		throw new Error(`Scenario must have non-empty 'rounds': ${filePath}`);
	}
	for (const round of data.rounds) {
		if (!round.prompt || typeof round.prompt !== "string") {
			throw new Error(`Each round must have a non-empty 'prompt': ${filePath}`);
		}
	}

	return data;
}

export function loadScenario(id: string): Scenario {
	const filePath = join(SCENARIOS_DIR, `${id}.json`);
	return parseScenarioFile(filePath);
}

export function loadAllScenarios(): Scenario[] {
	const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
	return files.map((f) => parseScenarioFile(join(SCENARIOS_DIR, f)));
}

export function loadScenariosByCategory(category: string): Scenario[] {
	return loadAllScenarios().filter((s) => s.category === category);
}
