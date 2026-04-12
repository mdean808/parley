export interface QualityRubric {
	addressesRequest: boolean;
	coherentDelivery: boolean;
	sufficientDepth: boolean;
	noMajorOmissions: boolean;
	efficientResolution: boolean;
}

export interface MultiAgentRubric {
	multipleAgentsContributed: boolean;
	distinctRoles: boolean;
	minimalRedundancy: boolean;
	complementaryCoverage: boolean;
	effectiveCoordination: boolean;
}

export interface JudgeEvaluation {
	pass: boolean;
	qualityScore: number;
	multiAgentValue: number;
	qualityRubric: QualityRubric;
	multiAgentRubric: MultiAgentRubric;
	summary: string;
	passReasoning: string;
	expectationAlignment?: number;
	expectationAlignmentReasoning?: string;
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
