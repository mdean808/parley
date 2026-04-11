export interface DimensionScore {
	dimension: string;
	score: number;
	reasoning: string;
}

export interface JudgeEvaluation {
	dimensions: DimensionScore[];
	overall: number;
	summary: string;
}

export interface JudgeUsage {
	inputTokens: number;
	outputTokens: number;
	model: string;
	durationMs: number;
	callCount: number;
}

export interface JudgeResult {
	perRound: JudgeEvaluation[];
	aggregate: JudgeEvaluation;
	usage: JudgeUsage;
}

export interface JudgeConfig {
	model?: string;
	enabled: boolean;
	dimensions?: string[];
}
