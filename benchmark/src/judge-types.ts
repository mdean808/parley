export interface JudgeEvaluation {
	pass: boolean;
	qualityScore: number;
	multiAgentValue: number;
	summary: string;
	passReasoning: string;
	qualityReasoning: string;
	multiAgentReasoning: string;
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
