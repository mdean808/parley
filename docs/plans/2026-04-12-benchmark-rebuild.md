# Benchmark System Rebuild — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the verbose, content-focused benchmark system with a lean probe-based system that tests protocol interaction quality (routing, handoff, collaboration).

**Architecture:** Single-shot probes replace multi-round scenarios. Two-layer evaluation: structural assertions (no LLM, instant) then pattern-aware LLM judge (only if assertions pass). Results grouped by interaction pattern. See `docs/BENCHMARK_DESIGN.md` for full design rationale.

**Tech Stack:** TypeScript, Bun, Anthropic SDK, chalk (all existing deps — no new deps needed)

---

## Files Overview

**Keep unchanged:** `collect.ts`, `pool.ts`

**Rewrite entirely:**
- `types.ts` — new Probe/ProbeResult/AssertionResult types
- `judge-types.ts` — pattern-specific rubric types
- `judge-prompt.ts` — pattern-aware prompts
- `judge.ts` — simplified pattern-aware evaluation
- `runner.ts` — single-shot probe runner
- `comparison.ts` — pattern-grouped aggregation
- `report-terminal.ts` — pattern-grouped terminal output
- `report-markdown.ts` — pattern-grouped markdown output
- `cli.ts` — updated flags

**Create new:**
- `assertions.ts` — pure function assertion checker
- `probes/index.ts` — probe loader
- `probes/*.json` — 15-20 probe files across 5 patterns

**Delete:**
- `multi-round.ts`
- `scenarios/index.ts`
- `scenarios/*.json` (all 7 files)

---

## Task 1: New type definitions

**Files:**
- Rewrite: `benchmark/src/types.ts`

Replace the entire file. Keep the `ProtocolId` re-export. Remove all multi-round types, ScenarioConfig, ScenarioRound. Add:

```typescript
import type { AgentResult } from "core/types";
import type { ProtocolId } from "protocols/factory";
import type { JudgeEvaluation, JudgeResult } from "./judge-types.ts";

export type { ProtocolId };

// --- Interaction patterns ---

export type InteractionPattern =
	| "single-route"
	| "selective-route"
	| "decline-all"
	| "handoff"
	| "collaborate";

// --- Probe definition (loaded from JSON) ---

export interface ProbeExpect {
	agentCount?: { min?: number; max?: number };
	requiredSkills?: string[];
	excludedSkills?: string[];
}

export interface ProbeConfig {
	id: string;
	prompt: string;
	pattern: InteractionPattern;
	targetSkills: string[];
	expect: ProbeExpect;
}

// --- Assertion results ---

export interface AssertionDetail {
	name: string;
	passed: boolean;
	expected: string;
	actual: string;
}

export interface AssertionResult {
	passed: boolean;
	details: AssertionDetail[];
}

// --- Agent result for a probe ---

export interface AgentProbeResult {
	agentName: string;
	skills: string[];
	responseText: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	durationMs: number;
	model: string;
}

// --- Single probe run result ---

export interface ProbeResult {
	probeId: string;
	protocolId: ProtocolId;
	pattern: InteractionPattern;
	prompt: string;
	agents: AgentProbeResult[];
	assertions: AssertionResult;
	judge?: JudgeEvaluation;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCost: number;
	totalDurationMs: number;
	error?: string;
}

// --- Aggregates ---

export interface PatternMetrics {
	pattern: InteractionPattern;
	assertionPassRate: number;
	judgePassRate: number;
	overallPassRate: number;
	avgInteractionScore: number;
	avgCost: number;
	probeCount: number;
	passedCount: number;
}

export interface ProtocolAggregateMetrics {
	overallPassRate: number;
	avgInteractionScore: number;
	avgCost: number;
	passedCount: number;
	totalCount: number;
	byPattern: Record<string, PatternMetrics>;
}

export interface ProbeComparison {
	probe: ProbeConfig;
	results: Record<string, ProbeResult>;
}

export interface ComparisonReport {
	generatedAt: string;
	model: string;
	protocolIds: string[];
	probes: ProbeComparison[];
	aggregate: {
		protocolMetrics: Record<string, ProtocolAggregateMetrics>;
	};
}
```

**Step 1:** Write the new `types.ts` with the types above.

**Step 2:** Commit: `feat(benchmark): replace types with probe-based definitions`

---

## Task 2: Assertion checker

**Files:**
- Create: `benchmark/src/assertions.ts`

Pure function, no LLM. Checks `ProbeExpect` against actual `AgentProbeResult[]`.

```typescript
import type { AgentProbeResult, AssertionDetail, AssertionResult, ProbeExpect } from "./types.ts";

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
					? agents.filter((a) => a.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase()))).map((a) => a.agentName).join(", ")
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
				actual: violators.length > 0
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
```

**Step 1:** Write `assertions.ts`.

**Step 2:** Commit: `feat(benchmark): add assertion checker for probe expectations`

---

## Task 3: Probe loader

**Files:**
- Create: `benchmark/src/probes/index.ts`

Same pattern as the old `scenarios/index.ts` but validates `ProbeConfig` shape. Reference existing loader at `benchmark/src/scenarios/index.ts:26-43` for the `readdir`/`readFile` pattern.

```typescript
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
		throw new Error(`Probe has invalid 'pattern' "${data.pattern}": ${filePath}`);
	}
	if (!data.expect || typeof data.expect !== "object") {
		throw new Error(`Probe missing 'expect': ${filePath}`);
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
```

**Step 1:** Create `benchmark/src/probes/` directory and write `index.ts`.

**Step 2:** Commit: `feat(benchmark): add probe loader`

---

## Task 4: Write probe JSON files

**Files:**
- Create: 15+ JSON files in `benchmark/src/probes/`

Organized by pattern. Each file is small (~5-8 lines). The skill names map to the actual agent skills in `agents.json`: `general-knowledge`, `research`, `creative-writing`, `brainstorming`, `coding`, `technical`.

### single-route probes (5)

**`route-technical-debug.json`:**
```json
{
	"id": "route-technical-debug",
	"prompt": "Can you help me debug this Python function that's throwing a KeyError when accessing a nested dictionary?",
	"pattern": "single-route",
	"targetSkills": ["coding"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["coding"],
		"excludedSkills": ["creative-writing"]
	}
}
```

**`route-creative-poem.json`:**
```json
{
	"id": "route-creative-poem",
	"prompt": "Write me a haiku about the ocean at sunset.",
	"pattern": "single-route",
	"targetSkills": ["creative-writing"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["creative-writing"],
		"excludedSkills": ["coding"]
	}
}
```

**`route-research-history.json`:**
```json
{
	"id": "route-research-history",
	"prompt": "What were the main causes of the fall of the Roman Empire?",
	"pattern": "single-route",
	"targetSkills": ["research"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["research"],
		"excludedSkills": ["coding"]
	}
}
```

**`route-technical-sql.json`:**
```json
{
	"id": "route-technical-sql",
	"prompt": "How do I write a SQL query to find duplicate rows in a table?",
	"pattern": "single-route",
	"targetSkills": ["technical"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["technical"],
		"excludedSkills": ["creative-writing"]
	}
}
```

**`route-creative-story.json`:**
```json
{
	"id": "route-creative-story",
	"prompt": "Give me a creative opening line for a mystery novel set in a lighthouse.",
	"pattern": "single-route",
	"targetSkills": ["creative-writing"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["creative-writing"],
		"excludedSkills": ["coding"]
	}
}
```

### selective-route probes (3)

**`selective-brainstorm-vs-research.json`:**
```json
{
	"id": "selective-brainstorm-vs-research",
	"prompt": "I need creative names for a new AI startup focused on climate tech.",
	"pattern": "selective-route",
	"targetSkills": ["brainstorming"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["brainstorming"],
		"excludedSkills": ["coding"]
	}
}
```

**`selective-technical-vs-research.json`:**
```json
{
	"id": "selective-technical-vs-research",
	"prompt": "Explain how a B-tree index works in a database and when I should use one.",
	"pattern": "selective-route",
	"targetSkills": ["technical"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["technical"],
		"excludedSkills": ["creative-writing"]
	}
}
```

**`selective-research-vs-creative.json`:**
```json
{
	"id": "selective-research-vs-creative",
	"prompt": "What is the current scientific consensus on how sleep affects memory consolidation?",
	"pattern": "selective-route",
	"targetSkills": ["research"],
	"expect": {
		"agentCount": { "max": 1 },
		"requiredSkills": ["research"],
		"excludedSkills": ["coding"]
	}
}
```

### decline-all probes (2)

**`decline-plumbing.json`:**
```json
{
	"id": "decline-plumbing",
	"prompt": "My kitchen sink is leaking. Can you come fix it this afternoon?",
	"pattern": "decline-all",
	"targetSkills": [],
	"expect": {
		"agentCount": { "max": 0 }
	}
}
```

**`decline-medical.json`:**
```json
{
	"id": "decline-medical",
	"prompt": "I have a sharp pain in my lower left abdomen. What medication should I take?",
	"pattern": "decline-all",
	"targetSkills": [],
	"expect": {
		"agentCount": { "max": 0 }
	}
}
```

### handoff probes (3)

**`handoff-creative-to-technical.json`:**
```json
{
	"id": "handoff-creative-to-technical",
	"prompt": "Write me a short poem about recursion, then show me a Python implementation of a recursive Fibonacci function.",
	"pattern": "handoff",
	"targetSkills": ["creative-writing", "coding"],
	"expect": {
		"requiredSkills": ["creative-writing", "coding"]
	}
}
```

**`handoff-research-to-creative.json`:**
```json
{
	"id": "handoff-research-to-creative",
	"prompt": "Give me the key facts about the Apollo 11 moon landing, then write a short fictional diary entry from Neil Armstrong's perspective.",
	"pattern": "handoff",
	"targetSkills": ["research", "creative-writing"],
	"expect": {
		"requiredSkills": ["research", "creative-writing"]
	}
}
```

**`handoff-research-to-technical.json`:**
```json
{
	"id": "handoff-research-to-technical",
	"prompt": "Explain the Dijkstra shortest-path algorithm conceptually, then write a working implementation in TypeScript.",
	"pattern": "handoff",
	"targetSkills": ["research", "coding"],
	"expect": {
		"requiredSkills": ["research", "coding"]
	}
}
```

### collaborate probes (3)

**`collaborate-startup-pitch.json`:**
```json
{
	"id": "collaborate-startup-pitch",
	"prompt": "Help me prepare a pitch for an AI-powered gardening app. I need market research, a catchy tagline, and a technical architecture overview.",
	"pattern": "collaborate",
	"targetSkills": ["research", "creative-writing", "technical"],
	"expect": {
		"agentCount": { "min": 2 },
		"requiredSkills": ["research", "creative-writing"]
	}
}
```

**`collaborate-blog-post.json`:**
```json
{
	"id": "collaborate-blog-post",
	"prompt": "Write a technical blog post about WebAssembly. It should have engaging creative prose and accurate technical details with code examples.",
	"pattern": "collaborate",
	"targetSkills": ["creative-writing", "coding"],
	"expect": {
		"agentCount": { "min": 2 },
		"requiredSkills": ["creative-writing", "coding"]
	}
}
```

**`collaborate-lesson-plan.json`:**
```json
{
	"id": "collaborate-lesson-plan",
	"prompt": "Create a lesson plan for teaching sorting algorithms to high school students. Include factual background, creative analogies, and working code examples.",
	"pattern": "collaborate",
	"targetSkills": ["research", "creative-writing", "coding"],
	"expect": {
		"agentCount": { "min": 2 },
		"requiredSkills": ["research", "coding"]
	}
}
```

**Step 1:** Create all 16 probe JSON files.

**Step 2:** Commit: `feat(benchmark): add interaction probe definitions`

---

## Task 5: New judge types

**Files:**
- Rewrite: `benchmark/src/judge-types.ts`

Replace the old QualityRubric/MultiAgentRubric with pattern-specific rubrics.

```typescript
export type InteractionPattern =
	| "single-route"
	| "selective-route"
	| "decline-all"
	| "handoff"
	| "collaborate";

// --- Pattern-specific rubrics ---

export interface RoutingRubric {
	promptRelevance: boolean;
	skillAlignment: boolean;
	cleanBoundaries: boolean;
}

export interface HandoffRubric {
	handoffClarity: boolean;
	contextPreserved: boolean;
	skillAlignment: boolean;
}

export interface CollaborateRubric {
	distinctContributions: boolean;
	skillAlignment: boolean;
	coherentWhole: boolean;
}

export type PatternRubric = RoutingRubric | HandoffRubric | CollaborateRubric;

// --- Judge evaluation ---

export interface JudgeEvaluation {
	pass: boolean;
	interactionScore: number; // count of true rubric items (0-3)
	contentAdequate: boolean;
	rubric: Record<string, boolean>; // flat key-value for flexibility
	summary: string;
	passReasoning: string;
}

export interface JudgeUsage {
	inputTokens: number;
	outputTokens: number;
	model: string;
	durationMs: number;
}

export interface JudgeConfig {
	model?: string;
	enabled: boolean;
}
```

**Step 1:** Write the new `judge-types.ts`.

**Step 2:** Commit: `feat(benchmark): add pattern-specific judge types`

---

## Task 6: New judge prompt

**Files:**
- Rewrite: `benchmark/src/judge-prompt.ts`

Pattern-aware system prompt. One system prompt with pattern-specific rubric sections. User prompt builder takes a probe + agent results.

```typescript
import type { InteractionPattern } from "./judge-types.ts";
import type { AgentProbeResult } from "./types.ts";

const RUBRIC_DESCRIPTIONS: Record<InteractionPattern, string> = {
	"single-route": `## Interaction Rubric (Routing)
For each criterion, answer true or false:
- **prompt_relevance**: The responding agent's reply directly addresses the user's request.
- **skill_alignment**: The response reflects the agent's claimed skill domain (e.g., a coding agent gives a technical answer, not a creative one).
- **clean_boundaries**: Non-responding agents stayed quiet rather than chiming in unnecessarily.`,

	"selective-route": `## Interaction Rubric (Selective Routing)
For each criterion, answer true or false:
- **prompt_relevance**: The responding agent's reply directly addresses the user's request.
- **skill_alignment**: The best-fit agent responded, not just any agent with tangential skills.
- **clean_boundaries**: Other agents who could have responded deferred to the better-fit agent.`,

	"decline-all": `## Interaction Rubric (Decline)
For each criterion, answer true or false:
- **prompt_relevance**: If any agent responded, the response honestly communicates inability or redirects the user rather than fabricating an answer.
- **skill_alignment**: No agent claimed expertise they don't have.
- **clean_boundaries**: Agents did not overreach their skill domains.`,

	"handoff": `## Interaction Rubric (Handoff)
For each criterion, answer true or false:
- **handoff_clarity**: The first agent clearly signaled it was passing to another agent or the system routed the sub-tasks to appropriate agents.
- **context_preserved**: The receiving agent picked up the task without requiring the user to repeat context.
- **skill_alignment**: Each agent operated within their skill domain (e.g., the creative part was done by a creative agent, the coding part by a technical agent).`,

	"collaborate": `## Interaction Rubric (Collaboration)
For each criterion, answer true or false:
- **distinct_contributions**: The agents said meaningfully different things, not repeating each other's content.
- **skill_alignment**: Each agent's contribution matches their skill domain.
- **coherent_whole**: The combined responses form a useful, complementary answer to the user's request.`,
};

export function buildJudgeSystemPrompt(pattern: InteractionPattern): string {
	return `You are an expert evaluator assessing AI agent interaction quality in a multi-agent system.
You will receive a user prompt and agent responses. Your job is to evaluate HOW the agents interacted — routing, handoffs, and collaboration — not the factual correctness of their answers.

${RUBRIC_DESCRIPTIONS[pattern]}

## Content Check
- **content_adequate**: As a minor secondary check, the collective response is not complete nonsense — it bears some reasonable relationship to the user's request. This is a very low bar.

## Pass/Fail
- PASS: All rubric criteria are true.
- FAIL: Any rubric criterion is false.

## Guidelines
- Focus on the interaction pattern, not the underlying LLM's knowledge.
- A factually imperfect answer that was correctly routed is better than a perfect answer from the wrong agent.
- Evaluate the system's routing/coordination decisions, not individual agent quality.`;
}

export function buildJudgeUserPrompt(
	prompt: string,
	targetSkills: string[],
	agents: AgentProbeResult[],
): string {
	const parts: string[] = [];

	parts.push(`## Probe`);
	parts.push(`**User prompt:** ${prompt}`);
	parts.push(`**Target skills:** ${targetSkills.join(", ") || "(none — all agents should decline)"}\n`);

	if (agents.length === 0) {
		parts.push("**No agents responded.**\n");
	} else {
		parts.push("## Agent Responses\n");
		for (const agent of agents) {
			parts.push(`**${agent.agentName}** (skills: ${agent.skills.join(", ")})`);
			parts.push(agent.responseText);
			parts.push("");
		}
	}

	parts.push("## Instructions");
	parts.push('Evaluate the interaction quality using the "evaluate" tool.');

	return parts.join("\n");
}
```

**Step 1:** Write the new `judge-prompt.ts`.

**Step 2:** Commit: `feat(benchmark): add pattern-aware judge prompts`

---

## Task 7: New judge evaluator

**Files:**
- Rewrite: `benchmark/src/judge.ts`

Simplified: one function, pattern-aware tool schema, no multi-round aggregation. Reuse the tool-use-forcing technique from the existing `judge.ts:220-227`.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./judge-prompt.ts";
import type { InteractionPattern, JudgeConfig, JudgeEvaluation, JudgeUsage } from "./judge-types.ts";
import type { AgentProbeResult } from "./types.ts";

const RUBRIC_FIELDS: Record<InteractionPattern, string[]> = {
	"single-route": ["prompt_relevance", "skill_alignment", "clean_boundaries"],
	"selective-route": ["prompt_relevance", "skill_alignment", "clean_boundaries"],
	"decline-all": ["prompt_relevance", "skill_alignment", "clean_boundaries"],
	"handoff": ["handoff_clarity", "context_preserved", "skill_alignment"],
	"collaborate": ["distinct_contributions", "skill_alignment", "coherent_whole"],
};

function buildEvaluateTool(pattern: InteractionPattern): Anthropic.Messages.Tool {
	const fields = RUBRIC_FIELDS[pattern];
	const properties: Record<string, object> = {};

	properties.pass = {
		type: "boolean",
		description: "Did the agents interact correctly for this pattern?",
	};
	properties.pass_reasoning = {
		type: "string",
		maxLength: 300,
		description: "Why pass or fail — focus on interaction quality.",
	};

	for (const field of fields) {
		properties[field] = {
			type: "boolean",
			description: `Rubric dimension: ${field.replace(/_/g, " ")}`,
		};
	}

	properties.content_adequate = {
		type: "boolean",
		description: "Minor check: the response is not complete nonsense.",
	};
	properties.summary = {
		type: "string",
		maxLength: 300,
	};

	return {
		name: "evaluate",
		description: "Submit interaction quality evaluation.",
		input_schema: {
			type: "object" as const,
			properties,
			required: ["pass", "pass_reasoning", ...fields, "content_adequate", "summary"],
		},
	};
}

function parseJudgeResponse(
	response: Anthropic.Messages.Message,
	pattern: InteractionPattern,
): JudgeEvaluation {
	const toolUse = response.content.find(
		(block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
	);

	if (!toolUse) {
		return {
			pass: false,
			interactionScore: 0,
			contentAdequate: false,
			rubric: {},
			summary: "Judge failed to respond with tool use.",
			passReasoning: "No tool response from judge.",
		};
	}

	const input = toolUse.input as Record<string, unknown>;
	const fields = RUBRIC_FIELDS[pattern];
	const rubric: Record<string, boolean> = {};

	for (const field of fields) {
		rubric[field] = Boolean(input[field]);
	}

	const interactionScore = Object.values(rubric).filter(Boolean).length;

	return {
		pass: Boolean(input.pass),
		interactionScore,
		contentAdequate: Boolean(input.content_adequate),
		rubric,
		summary: String(input.summary ?? ""),
		passReasoning: String(input.pass_reasoning ?? ""),
	};
}

export async function evaluateProbe(
	prompt: string,
	targetSkills: string[],
	agents: AgentProbeResult[],
	pattern: InteractionPattern,
	config: JudgeConfig,
): Promise<{ evaluation: JudgeEvaluation; usage: JudgeUsage }> {
	const model = config.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-4-6";
	const client = new Anthropic();

	const systemPrompt = buildJudgeSystemPrompt(pattern);
	const userPrompt = buildJudgeUserPrompt(prompt, targetSkills, agents);
	const tool = buildEvaluateTool(pattern);

	const start = performance.now();
	const response = await client.messages.create({
		model,
		max_tokens: 1024,
		system: systemPrompt,
		messages: [{ role: "user", content: userPrompt }],
		tools: [tool],
		tool_choice: { type: "tool", name: "evaluate" },
	});

	const usage: JudgeUsage = {
		inputTokens: response.usage.input_tokens,
		outputTokens: response.usage.output_tokens,
		model,
		durationMs: performance.now() - start,
	};

	const evaluation = parseJudgeResponse(response, pattern);
	return { evaluation, usage };
}
```

**Step 1:** Write the new `judge.ts`.

**Step 2:** Commit: `feat(benchmark): rewrite judge with pattern-aware evaluation`

---

## Task 8: New runner

**Files:**
- Rewrite: `benchmark/src/runner.ts`

Drastically simplified. No multi-round logic, no round loops. Single-shot: send prompt, collect results, check assertions, optionally judge.

Reuse existing `collect.ts` (`collectSendRequest`, `ResultCollector`) unchanged.

```typescript
import { MODEL } from "core/config";
import { computeCost } from "core/cost";
import type { Protocol } from "core/types";
import { checkAssertions } from "./assertions.ts";
import { collectSendRequest, type ResultCollector } from "./collect.ts";
import { evaluateProbe } from "./judge.ts";
import type { JudgeConfig } from "./judge-types.ts";
import type {
	AgentProbeResult,
	ProbeConfig,
	ProbeResult,
	ProtocolId,
} from "./types.ts";

export { ResultCollector } from "./collect.ts";

export async function runProbe(
	protocol: Protocol,
	protocolId: ProtocolId,
	probe: ProbeConfig,
	judgeConfig?: JudgeConfig,
	onPhase?: (phase: string) => void,
	collector?: ResultCollector,
): Promise<ProbeResult> {
	const { userId } = await protocol.initialize("BenchUser");
	const chainId = crypto.randomUUID();

	let agents: AgentProbeResult[] = [];
	let error: string | undefined;

	const start = performance.now();
	try {
		if (collector) {
			const results = await collectSendRequest(
				protocol,
				collector,
				userId,
				probe.prompt,
				chainId,
			);
			agents = results.map((r) => {
				const inputTokens = r.usage?.inputTokens ?? 0;
				const outputTokens = r.usage?.outputTokens ?? 0;
				const model = r.model ?? MODEL;
				return {
					agentName: r.agentName,
					skills: r.skills,
					responseText: r.response.payload,
					inputTokens,
					outputTokens,
					cost: r.cost ?? computeCost(inputTokens, outputTokens, model),
					durationMs: r.durationMs ?? 0,
					model,
				};
			});
		} else {
			await protocol.sendRequest(userId, probe.prompt, chainId);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
	const totalDurationMs = performance.now() - start;

	// Layer 1: Assertions
	const assertions = error
		? { passed: false, details: [{ name: "execution", passed: false, expected: "no error", actual: error }] }
		: checkAssertions(probe.expect, agents);

	// Layer 2: Judge (only if assertions pass and judge enabled)
	let judge: ProbeResult["judge"];
	if (assertions.passed && judgeConfig?.enabled && !error) {
		onPhase?.("judge");
		try {
			const { evaluation } = await evaluateProbe(
				probe.prompt,
				probe.targetSkills,
				agents,
				probe.pattern,
				judgeConfig,
			);
			judge = evaluation;
		} catch (err) {
			// Judge failure doesn't fail the probe — just no judge data
			judge = undefined;
		}
	}

	return {
		probeId: probe.id,
		protocolId,
		pattern: probe.pattern,
		prompt: probe.prompt,
		agents,
		assertions,
		judge,
		totalInputTokens: agents.reduce((s, a) => s + a.inputTokens, 0),
		totalOutputTokens: agents.reduce((s, a) => s + a.outputTokens, 0),
		totalCost: agents.reduce((s, a) => s + a.cost, 0),
		totalDurationMs,
		error,
	};
}
```

**Step 1:** Write the new `runner.ts`.

**Step 2:** Commit: `feat(benchmark): rewrite runner for single-shot probes`

---

## Task 9: New comparison engine

**Files:**
- Rewrite: `benchmark/src/comparison.ts`

Simpler aggregation. Group by pattern. Reuse `pool.ts` unchanged.

```typescript
import { MODEL } from "core/config";
import { createProtocol, getProtocolIds } from "protocols/factory";
import type { JudgeConfig } from "./judge-types.ts";
import { runPool } from "./pool.ts";
import {
	loadAllProbes,
	loadProbe,
	loadProbesByPattern,
} from "./probes/index.ts";
import { ResultCollector, runProbe } from "./runner.ts";
import type {
	ComparisonReport,
	InteractionPattern,
	PatternMetrics,
	ProbeComparison,
	ProbeConfig,
	ProbeResult,
	ProtocolAggregateMetrics,
} from "./types.ts";

export type ProgressEvent =
	| { type: "start"; probeId: string; protocolId: string; totalTasks: number }
	| { type: "phase"; probeId: string; protocolId: string; phase: string }
	| { type: "complete"; probeId: string; protocolId: string; durationMs: number; error?: string };

export interface ComparisonOptions {
	probes?: string[];
	patterns?: InteractionPattern[];
	protocols?: string[];
	judgeConfig?: JudgeConfig;
	concurrency?: number;
	onProgress?: (event: ProgressEvent) => void;
}

function computePatternMetrics(
	results: ProbeResult[],
	pattern: InteractionPattern,
): PatternMetrics {
	const patternResults = results.filter((r) => r.pattern === pattern);
	if (patternResults.length === 0) {
		return {
			pattern,
			assertionPassRate: 0,
			judgePassRate: 0,
			overallPassRate: 0,
			avgInteractionScore: 0,
			avgCost: 0,
			probeCount: 0,
			passedCount: 0,
		};
	}

	const assertionPassed = patternResults.filter((r) => r.assertions.passed);
	const judged = assertionPassed.filter((r) => r.judge);
	const judgePassed = judged.filter((r) => r.judge?.pass);
	const overallPassed = patternResults.filter(
		(r) => r.assertions.passed && (r.judge?.pass ?? r.assertions.passed),
	);

	const scoredResults = judged.filter((r) => r.judge);
	const avgScore =
		scoredResults.length > 0
			? scoredResults.reduce((s, r) => s + (r.judge?.interactionScore ?? 0), 0) / scoredResults.length
			: 0;

	return {
		pattern,
		assertionPassRate: (assertionPassed.length / patternResults.length) * 100,
		judgePassRate: judged.length > 0 ? (judgePassed.length / judged.length) * 100 : 0,
		overallPassRate: (overallPassed.length / patternResults.length) * 100,
		avgInteractionScore: avgScore,
		avgCost:
			patternResults.reduce((s, r) => s + r.totalCost, 0) / patternResults.length,
		probeCount: patternResults.length,
		passedCount: overallPassed.length,
	};
}

export async function runComparison(
	options: ComparisonOptions = {},
): Promise<ComparisonReport> {
	const progress = options.onProgress ?? (() => {});
	const protocolIds = options.protocols ?? getProtocolIds();
	const judgeConfig: JudgeConfig = options.judgeConfig ?? { enabled: true };

	// Load probes
	let probes: ProbeConfig[];
	if (options.probes) {
		probes = await Promise.all(options.probes.map((id) => loadProbe(id)));
	} else if (options.patterns) {
		const results = await Promise.all(
			options.patterns.map((p) => loadProbesByPattern(p)),
		);
		probes = results.flat();
	} else {
		probes = await loadAllProbes();
	}

	const concurrency = options.concurrency ?? 3;
	const totalTasks = probes.length * protocolIds.length;

	interface TaskResult {
		probeIndex: number;
		protocolId: string;
		result: ProbeResult;
	}

	const tasks = probes.flatMap((probe, pi) =>
		protocolIds.map((pid) => async (): Promise<TaskResult> => {
			progress({ type: "start", probeId: probe.id, protocolId: pid, totalTasks });
			const taskStart = performance.now();
			try {
				const collector = new ResultCollector();
				const protocol = createProtocol(pid, { onMessage: collector.handler });
				const result = await runProbe(
					protocol,
					pid,
					probe,
					judgeConfig,
					(phase) => progress({ type: "phase", probeId: probe.id, protocolId: pid, phase }),
					collector,
				);
				progress({
					type: "complete",
					probeId: probe.id,
					protocolId: pid,
					durationMs: performance.now() - taskStart,
				});
				return { probeIndex: pi, protocolId: pid, result };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				progress({
					type: "complete",
					probeId: probe.id,
					protocolId: pid,
					durationMs: performance.now() - taskStart,
					error: msg,
				});
				return {
					probeIndex: pi,
					protocolId: pid,
					result: {
						probeId: probe.id,
						protocolId: pid,
						pattern: probe.pattern,
						prompt: probe.prompt,
						agents: [],
						assertions: { passed: false, details: [{ name: "execution", passed: false, expected: "no error", actual: msg }] },
						totalInputTokens: 0,
						totalOutputTokens: 0,
						totalCost: 0,
						totalDurationMs: 0,
						error: msg,
					},
				};
			}
		}),
	);

	const taskResults = await runPool(tasks, concurrency);

	// Build probe comparisons
	const probeComparisons: ProbeComparison[] = probes.map((probe, pi) => {
		const results: Record<string, ProbeResult> = {};
		for (const tr of taskResults) {
			if (tr.probeIndex === pi) results[tr.protocolId] = tr.result;
		}
		return { probe, results };
	});

	// Aggregate metrics per protocol
	const protocolMetrics: Record<string, ProtocolAggregateMetrics> = {};
	const allPatterns: InteractionPattern[] = [
		"single-route",
		"selective-route",
		"decline-all",
		"handoff",
		"collaborate",
	];

	for (const pid of protocolIds) {
		const allResults = probeComparisons
			.map((pc) => pc.results[pid])
			.filter((r): r is ProbeResult => r != null);

		const overallPassed = allResults.filter(
			(r) => r.assertions.passed && (r.judge?.pass ?? r.assertions.passed),
		);

		const scoredResults = allResults.filter((r) => r.judge);
		const avgScore =
			scoredResults.length > 0
				? scoredResults.reduce((s, r) => s + (r.judge?.interactionScore ?? 0), 0) / scoredResults.length
				: 0;

		const byPattern: Record<string, PatternMetrics> = {};
		for (const pattern of allPatterns) {
			const patternResults = allResults.filter((r) => r.pattern === pattern);
			if (patternResults.length > 0) {
				byPattern[pattern] = computePatternMetrics(allResults, pattern);
			}
		}

		protocolMetrics[pid] = {
			overallPassRate: allResults.length > 0 ? (overallPassed.length / allResults.length) * 100 : 0,
			avgInteractionScore: avgScore,
			avgCost: allResults.length > 0 ? allResults.reduce((s, r) => s + r.totalCost, 0) / allResults.length : 0,
			passedCount: overallPassed.length,
			totalCount: allResults.length,
			byPattern,
		};
	}

	return {
		generatedAt: new Date().toISOString(),
		model: MODEL,
		protocolIds,
		probes: probeComparisons,
		aggregate: { protocolMetrics },
	};
}
```

**Step 1:** Write the new `comparison.ts`.

**Step 2:** Commit: `feat(benchmark): rewrite comparison engine with pattern grouping`

---

## Task 10: New terminal report

**Files:**
- Rewrite: `benchmark/src/report-terminal.ts`

Pattern-grouped output matching the mockup from the design doc.

```typescript
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
			pad(`${m.passedCount}/${m.totalCount} (${m.overallPassRate.toFixed(0)}%)`, cols[1]),
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

	const patterns = ["single-route", "selective-route", "decline-all", "handoff", "collaborate"];
	for (const pattern of patterns) {
		const vals = protocolIds.map((pid) => {
			const pm = metrics[pid]?.byPattern[pattern];
			if (!pm || pm.probeCount === 0) return pad(chalk.dim("—"), protoCol);
			const pct = pm.overallPassRate.toFixed(0);
			const label = `${pct}% (${pm.passedCount}/${pm.probeCount})`;
			const colored = pm.overallPassRate >= 70 ? chalk.green(label) : pm.overallPassRate >= 40 ? chalk.yellow(label) : chalk.red(label);
			return pad(colored, protoCol);
		});
		console.log([pad(pattern, patternCol), ...vals].join(" | "));
	}

	// Failures
	const failures: { probeId: string; protocolId: string; reason: string }[] = [];
	for (const pc of report.probes) {
		for (const pid of protocolIds) {
			const r = pc.results[pid];
			if (!r) continue;
			if (r.error) {
				failures.push({ probeId: r.probeId, protocolId: pid, reason: r.error });
			} else if (!r.assertions.passed) {
				const failed = r.assertions.details.filter((d) => !d.passed);
				const reason = failed.map((d) => `${d.name}: expected ${d.expected}, got ${d.actual}`).join("; ");
				failures.push({ probeId: r.probeId, protocolId: pid, reason });
			} else if (r.judge && !r.judge.pass) {
				failures.push({ probeId: r.probeId, protocolId: pid, reason: r.judge.passReasoning });
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
```

**Step 1:** Write the new `report-terminal.ts`.

**Step 2:** Commit: `feat(benchmark): rewrite terminal report with pattern grouping`

---

## Task 11: New markdown report

**Files:**
- Rewrite: `benchmark/src/report-markdown.ts`

Leaner version — summary, pattern breakdown, failures. No per-round token tables or agent participation matrices.

```typescript
import type { ComparisonReport } from "./types.ts";

export function generateMarkdownReport(report: ComparisonReport): string {
	const lines: string[] = [];
	const { protocolIds } = report;
	const metrics = report.aggregate.protocolMetrics;

	lines.push("# Protocol Interaction Benchmark Report\n");
	lines.push(`*Run: ${report.generatedAt}*\n`);

	// Summary
	lines.push("## Summary\n");
	lines.push(`Tested ${protocolIds.length} protocol(s) across ${report.probes.length} interaction probes using model \`${report.model}\`.\n`);

	// Protocol comparison table
	lines.push("## Protocol Comparison\n");
	lines.push("| Protocol | Overall Pass | Avg Score | Avg Cost |");
	lines.push("|----------|-------------|-----------|----------|");
	for (const pid of protocolIds) {
		const m = metrics[pid];
		lines.push(`| ${pid} | ${m.passedCount}/${m.totalCount} (${m.overallPassRate.toFixed(1)}%) | ${m.avgInteractionScore.toFixed(1)}/3 | $${m.avgCost.toFixed(4)} |`);
	}
	lines.push("");

	// Pattern breakdown
	lines.push("## Results by Pattern\n");
	const patterns = ["single-route", "selective-route", "decline-all", "handoff", "collaborate"];

	for (const pattern of patterns) {
		const hasData = protocolIds.some((pid) => metrics[pid]?.byPattern[pattern]?.probeCount > 0);
		if (!hasData) continue;

		lines.push(`### ${pattern}\n`);
		lines.push("| Protocol | Pass Rate | Avg Score | Probes |");
		lines.push("|----------|-----------|-----------|--------|");
		for (const pid of protocolIds) {
			const pm = metrics[pid]?.byPattern[pattern];
			if (!pm || pm.probeCount === 0) {
				lines.push(`| ${pid} | — | — | 0 |`);
			} else {
				lines.push(`| ${pid} | ${pm.overallPassRate.toFixed(1)}% (${pm.passedCount}/${pm.probeCount}) | ${pm.avgInteractionScore.toFixed(1)}/3 | ${pm.probeCount} |`);
			}
		}
		lines.push("");
	}

	// Per-probe details
	lines.push("## Probe Details\n");
	for (const pc of report.probes) {
		lines.push(`### ${pc.probe.id}\n`);
		lines.push(`**Pattern:** ${pc.probe.pattern} | **Target skills:** ${pc.probe.targetSkills.join(", ") || "none"}\n`);
		lines.push(`> ${pc.probe.prompt}\n`);

		lines.push("| Protocol | Assertions | Judge | Score | Agents |");
		lines.push("|----------|-----------|-------|-------|--------|");
		for (const pid of protocolIds) {
			const r = pc.results[pid];
			if (!r) { lines.push(`| ${pid} | — | — | — | — |`); continue; }
			if (r.error) { lines.push(`| ${pid} | ERR | — | — | — |`); continue; }
			const assertions = r.assertions.passed ? "PASS" : "FAIL";
			const judge = r.judge ? (r.judge.pass ? "PASS" : "FAIL") : "—";
			const score = r.judge ? `${r.judge.interactionScore}/3` : "—";
			const agents = r.agents.map((a) => a.agentName).join(", ") || "none";
			lines.push(`| ${pid} | ${assertions} | ${judge} | ${score} | ${agents} |`);
		}
		lines.push("");
	}

	lines.push("---\n*Generated by the protocol interaction benchmark system.*\n");
	return lines.join("\n");
}
```

**Step 1:** Write the new `report-markdown.ts`.

**Step 2:** Commit: `feat(benchmark): rewrite markdown report with pattern grouping`

---

## Task 12: New CLI

**Files:**
- Rewrite: `benchmark/src/cli.ts`

Replace `--scenarios`, `--category` with `--probes`, `--pattern`. Keep `--protocols`, `--no-judge`, `--judge-model`, `--concurrency`, `--output`, `--no-report`. Same spinner UI approach.

The CLI code follows the same structure as the existing `cli.ts` — parse args, call `runComparison`, render progress, write output files. Replace scenario references with probe references, and update the progress event types to use `probeId` instead of `scenarioName`.

**Step 1:** Write the new `cli.ts`. Replace `--scenarios`/`--category` flags with `--probes`/`--pattern`. Update progress rendering to show probe IDs. Keep the spinner, file output, and chalk formatting.

**Step 2:** Commit: `feat(benchmark): update CLI for probe-based benchmarks`

---

## Task 13: Delete old files

**Files:**
- Delete: `benchmark/src/multi-round.ts`
- Delete: `benchmark/src/scenarios/index.ts`
- Delete: `benchmark/src/scenarios/domain-shifting.json`
- Delete: `benchmark/src/scenarios/agent-debate.json`
- Delete: `benchmark/src/scenarios/build-rest-node.json`
- Delete: `benchmark/src/scenarios/ambiguous-routing.json`
- Delete: `benchmark/src/scenarios/emergent-coordination.json`
- Delete: `benchmark/src/scenarios/synthesis-required.json`
- Delete: `benchmark/src/scenarios/adversarial-edge.json`

**Step 1:** Delete all files listed above.

**Step 2:** Remove the `benchmark/src/scenarios/` directory.

**Step 3:** Commit: `chore(benchmark): remove old scenario-based benchmark files`

---

## Task 14: Verification

Run `bun run bench --protocols v2,simple --no-judge` to verify the system loads probes, runs them, checks assertions, and produces a terminal report without errors.

Then run `bun run bench --protocols v2,simple --probes route-technical-debug` with judge enabled to verify end-to-end with a single probe.

Check that:
- Probes load from `probes/` directory
- Assertions produce pass/fail with detail messages
- Judge returns pattern-specific rubric scores
- Terminal report shows pattern-grouped breakdown
- JSON and markdown files are written to `benchmark/results/`
