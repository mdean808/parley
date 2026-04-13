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
	interactionScore: number; // count of true interaction rubric items (0-3)
	contentScore: number; // count of true content rubric items (0-3)
	compositeScore: number; // interaction * 0.7 + content * 0.3 (each normalized to 0-100)
	contentAdequate: boolean; // derived: contentScore >= 1
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
