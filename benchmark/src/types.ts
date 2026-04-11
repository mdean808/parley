import type { ProtocolId } from "protocols/factory";
import type { AgentResult } from "core/types";
import type { JudgeEvaluation, JudgeResult } from "./judge-types.ts";

export type { ProtocolId };

// --- Multi-round types (Plan 02) ---

export interface MultiRoundConfig {
	rounds: number;
	followUpInstruction?: string;
	crossAgentContext?: boolean;
}

export interface RoundMetrics {
	roundIndex: number;
	prompt: string;
	results: AgentResult[];
	totalInputTokens: number;
	totalOutputTokens: number;
	totalDurationMs: number;
	cost: number;
}

export interface MultiRoundResult {
	scenarioName: string;
	protocol: string;
	rounds: RoundMetrics[];
	cumulative: {
		totalInputTokens: number;
		totalOutputTokens: number;
		totalDurationMs: number;
		totalCost: number;
		roundCount: number;
		stoppedEarly: boolean;
		error?: string;
	};
}

export interface ScenarioRound {
	prompt: string;
}

export interface ScenarioConfig {
	name: string;
	topic: string;
	rounds: ScenarioRound[];
	protocols?: ProtocolId[];
	multiRound?: MultiRoundConfig;
}

export interface AgentRoundResult {
	agentName: string;
	skills: string[];
	responseText: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	durationMs: number;
	model: string;
}

export interface RoundResult {
	roundIndex: number;
	prompt: string;
	agents: AgentRoundResult[];
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCost: number;
	totalDurationMs: number;
	respondingAgentCount: number;
	judge?: JudgeEvaluation;
}

export interface ProtocolRunResult {
	protocolId: ProtocolId;
	scenarioName: string;
	rounds: RoundResult[];
	aggregate: {
		totalInputTokens: number;
		totalOutputTokens: number;
		totalCost: number;
		totalDurationMs: number;
		averageAgentsPerRound: number;
		roundCount: number;
	};
	judge?: JudgeResult;
	error?: string;
}

export interface BenchmarkOutput {
	timestamp: string;
	model: string;
	scenarios: ProtocolRunResult[];
}

export interface BenchOptions {
	outputPath?: string;
	protocols?: ProtocolId[];
	scenarios?: ScenarioConfig[];
}
