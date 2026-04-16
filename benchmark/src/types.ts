import type { ProtocolId } from "protocols/factory";
import type { JudgeEvaluation } from "./judge-types.ts";

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
	// Optional: restrict this probe to protocols that structurally can attempt it.
	// Omit or leave undefined for "all protocols". Ineligible protocols are reported
	// as N/A, not counted as failures. Useful for parley-only probes (CANCEL cascade,
	// exclusive CLAIM, TTL mid-PROCESS) where non-routing baselines have nothing to prove.
	eligibleProtocols?: string[];
}

// --- Assertion results ---

export interface AssertionDetail {
	name: string;
	passed: boolean;
	status: "pass" | "fail" | "na";
	expected: string;
	actual: string;
	reason?: string;
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

// --- Decline info (from onEvent, not from agent responses) ---

export interface DeclineInfo {
	agentName: string;
	reason: string;
}

// --- Per-agent terminal state (responded / declined / errored / timed-out) ---

export type AgentTerminalStatus =
	| "responded"
	| "declined"
	| "errored"
	| "timed-out";

export interface AgentTerminalState {
	agentName: string;
	skills: string[];
	status: AgentTerminalStatus;
	reason?: string;
}

// --- Wire-efficiency measurement (parley-only: TOON vs JSON) ---

export interface WireEfficiency {
	sampleCount: number;
	toonChars: number;
	jsonChars: number;
	ratio: number; // toonChars / jsonChars, <1 means TOON is smaller
}

// --- Protocol-integrity invariants (parley-only) ---

export interface IntegrityViolation {
	rule: "sequence-gap" | "missing-ack";
	detail: string;
}

export interface IntegritySummary {
	passed: boolean;
	checkedMessages: number;
	violations: IntegrityViolation[];
}

// --- Single probe run result ---

export interface ProbeResult {
	probeId: string;
	protocolId: ProtocolId;
	pattern: InteractionPattern;
	prompt: string;
	agents: AgentProbeResult[];
	declines?: DeclineInfo[];
	assertions: AssertionResult;
	judge?: JudgeEvaluation;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCost: number;
	totalDurationMs: number;
	wireEfficiency?: WireEfficiency;
	integrity?: IntegritySummary;
	error?: string;
}

// --- Aggregates ---

export interface PatternMetrics {
	pattern: InteractionPattern;
	assertionPassRate: number;
	judgePassRate: number;
	overallPassRate: number;
	scoreRate: number; // avgCompositeScore — primary metric (interaction + content)
	scoreRateStdDev: number; // 0 when only a single run; sample std dev across all runs otherwise
	interactionScoreRate: number; // avgInteractionScore / 3 * 100
	contentScoreRate: number; // avgContentScore / 3 * 100
	avgInteractionScore: number;
	avgContentScore: number;
	avgCompositeScore: number; // (interaction + content) / 6 * 100
	avgCost: number;
	avgDurationMs: number;
	probeCount: number;
	passedCount: number;
	runs: number; // total run count across all probes in this pattern (for variance context)
}

export interface ProtocolAggregateMetrics {
	overallPassRate: number;
	scoreRate: number; // avgCompositeScore — primary metric (interaction + content)
	scoreRateStdDev: number; // 0 when only a single run; sample std dev across all runs otherwise
	interactionScoreRate: number; // avgInteractionScore / 3 * 100
	contentScoreRate: number; // avgContentScore / 3 * 100
	avgInteractionScore: number;
	avgContentScore: number;
	avgCompositeScore: number;
	avgCost: number;
	avgDurationMs: number;
	avgInputTokens: number; // per-run input tokens (sum across agents)
	avgOutputTokens: number; // per-run output tokens (sum across agents)
	scorePerKToken: number; // composite score per thousand total tokens (higher = more efficient)
	costEfficiency: number; // compositeScore / avgCost (higher = better)
	avgWireRatio?: number; // mean TOON/JSON ratio across runs; <1 means TOON is smaller (parley-only)
	avgWireSamples?: number; // mean messages-per-run measured for wire efficiency
	integrityRate?: number; // 0..100, % of scored runs that passed all integrity checks (parley-only)
	passedCount: number;
	totalCount: number;
	runs: number; // total scored run count (sum over probes)
	byPattern: Record<string, PatternMetrics>;
}

export interface ProbeComparison {
	probe: ProbeConfig;
	// First run per protocol — always populated; used for single-run rendering.
	results: Record<string, ProbeResult>;
	// All runs per protocol — populated when --runs N > 1. Same content as `results`
	// for N=1. Aggregators use this for std-dev calculation.
	runs?: Record<string, ProbeResult[]>;
}

// --- Per-protocol config audit (surfaces model/max_tokens disparities) ---

export interface ProtocolConfigAudit {
	protocolId: string;
	models: string[]; // unique model values observed across this protocol's probe responses
	maxOutputTokens: number | "unknown";
	source: "ts-constant" | "external-env" | "cli-default" | "unknown";
	notes?: string;
}

export interface ComparisonReport {
	generatedAt: string;
	model: string;
	protocolIds: string[];
	probes: ProbeComparison[];
	aggregate: {
		protocolMetrics: Record<string, ProtocolAggregateMetrics>;
	};
	configAudit: ProtocolConfigAudit[];
}
