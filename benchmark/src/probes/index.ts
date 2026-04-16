import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InteractionPattern, ProbeConfig } from "../types.ts";

const PROBES_DIR = new URL(".", import.meta.url).pathname;

const VALID_PATTERNS: Set<string> = new Set([
	"single-route",
	"selective-route",
	"decline-all",
	"handoff",
	"collaborate",
]);

async function parseProbeFile(filePath: string): Promise<ProbeConfig> {
	const raw = await readFile(filePath, "utf-8");
	const data = JSON.parse(raw) as ProbeConfig;

	if (!data.id || typeof data.id !== "string") {
		throw new Error(`Probe missing 'id': ${filePath}`);
	}
	if (!data.prompt || typeof data.prompt !== "string") {
		throw new Error(`Probe missing 'prompt': ${filePath}`);
	}
	if (!VALID_PATTERNS.has(data.pattern)) {
		throw new Error(
			`Probe has invalid 'pattern' "${data.pattern}": ${filePath}`,
		);
	}
	if (!data.expect || typeof data.expect !== "object") {
		throw new Error(`Probe missing 'expect': ${filePath}`);
	}
	if (data.eligibleProtocols !== undefined) {
		if (
			!Array.isArray(data.eligibleProtocols) ||
			data.eligibleProtocols.some((p) => typeof p !== "string")
		) {
			throw new Error(
				`Probe 'eligibleProtocols' must be a string array if set: ${filePath}`,
			);
		}
	}

	return data;
}

export async function loadProbe(id: string): Promise<ProbeConfig> {
	const filePath = join(PROBES_DIR, `${id}.json`);
	return parseProbeFile(filePath);
}

export async function loadAllProbes(): Promise<ProbeConfig[]> {
	const files = (await readdir(PROBES_DIR)).filter((f) => f.endsWith(".json"));
	return Promise.all(files.map((f) => parseProbeFile(join(PROBES_DIR, f))));
}

export async function loadProbesByPattern(
	pattern: InteractionPattern,
): Promise<ProbeConfig[]> {
	const all = await loadAllProbes();
	return all.filter((p) => p.pattern === pattern);
}
