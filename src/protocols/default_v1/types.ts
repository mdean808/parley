import type { Agent, MessageType } from "../../types.ts";

export interface SkillEvalResult {
	relevant: boolean;
	neededSkills: string[];
}

export interface AgentBrain {
	shouldHandle(request: BrainRequest): Promise<SkillEvalResult>;
	generateResponse(request: BrainRequest): Promise<BrainResponse>;
	shouldDelegate?(request: BrainRequest): Promise<DelegationRequest | null>;
	generateDelegatedResponse?(
		request: BrainRequest,
		delegationResults: DelegationResult[],
	): Promise<BrainResponse>;
}

export interface DelegationRequest {
	payload: string;
	targetSkills: string[];
}

export interface DelegationResult {
	agentName: string;
	agentId: string;
	payload: string;
	type: MessageType;
}

export interface BrainRequest {
	agent: Agent;
	payload: string;
	rawMessage: string;
	allSkills: string[];
}

export interface BrainResponse {
	text: string;
	meta: BrainMeta;
}

export interface BrainMeta {
	usage: { inputTokens: number; outputTokens: number };
	model: string;
	durationMs: number;
}
