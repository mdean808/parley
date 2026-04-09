import { readdir, readFile } from "node:fs/promises";
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

async function parseScenarioFile(filePath: string): Promise<Scenario> {
	const raw = await readFile(filePath, "utf-8");
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

export async function loadScenario(id: string): Promise<Scenario> {
	const filePath = join(SCENARIOS_DIR, `${id}.json`);
	return parseScenarioFile(filePath);
}

export async function loadAllScenarios(): Promise<Scenario[]> {
	const files = (await readdir(SCENARIOS_DIR)).filter((f) => f.endsWith(".json"));
	return Promise.all(files.map((f) => parseScenarioFile(join(SCENARIOS_DIR, f))));
}

export async function loadScenariosByCategory(category: string): Promise<Scenario[]> {
	const all = await loadAllScenarios();
	return all.filter((s) => s.category === category);
}
