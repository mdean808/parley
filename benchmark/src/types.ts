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
