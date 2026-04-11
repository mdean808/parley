export interface CrewAIConfig {
	baseUrl: string;
	mode: "single" | "crew";
}

export interface SingleRunRequest {
	agent_name: string;
	message: string;
	system_prompt: string;
	chain_id?: string;
}

export interface SingleRunResponse {
	agent_name: string;
	response_text: string;
	usage: { input_tokens: number; output_tokens: number } | null;
	model: string | null;
	duration_ms: number | null;
	error: string | null;
}

export interface CrewRunRequest {
	message: string;
	chain_id?: string;
}

export interface CrewRunResponse {
	results: SingleRunResponse[];
	total_duration_ms: number;
	error: string | null;
}

export interface CrewAIHealthResponse {
	status: string;
	agents: string[];
}
