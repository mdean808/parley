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
	error?: string;
}

// --- Aggregates ---

export interface PatternMetrics {
	pattern: InteractionPattern;
	assertionPassRate: number;
	judgePassRate: number;
	overallPassRate: number;
	scoreRate: number; // avgCompositeScore — primary metric (interaction + content)
	interactionScoreRate: number; // avgInteractionScore / 3 * 100
	contentScoreRate: number; // avgContentScore / 3 * 100
	avgInteractionScore: number;
	avgContentScore: number;
	avgCompositeScore: number; // (interaction + content) / 6 * 100
	avgCost: number;
	avgDurationMs: number;
	probeCount: number;
	passedCount: number;
}

export interface ProtocolAggregateMetrics {
	overallPassRate: number;
	scoreRate: number; // avgCompositeScore — primary metric (interaction + content)
	interactionScoreRate: number; // avgInteractionScore / 3 * 100
	contentScoreRate: number; // avgContentScore / 3 * 100
	avgInteractionScore: number;
	avgContentScore: number;
	avgCompositeScore: number;
	avgCost: number;
	avgDurationMs: number;
	costEfficiency: number; // compositeScore / avgCost (higher = better)
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
