import type { ProtocolId } from "../factory.ts";
import type { AgentResult } from "../types.ts";
import type { JudgeResult } from "./judge-types.ts";

export type { ProtocolId };

// --- Multi-round types (Plan 02) ---

export type RoundSynthesizer = (
	roundIndex: number,
	previousResults: AgentResult[],
	originalPrompt: string,
) => string;

export interface MultiRoundConfig {
	rounds: number;
	synthesizer?: RoundSynthesizer;
	stopCondition?: (roundIndex: number, results: AgentResult[]) => boolean;
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
