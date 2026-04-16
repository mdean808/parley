import Anthropic from "@anthropic-ai/sdk";

export const MODEL: string = process.env.MODEL || "claude-sonnet-4-6";
export const client: Anthropic = new Anthropic();

// Shared across all protocols so benchmarks compare apples to apples.
// Python servers (external/a2a, external/crewai) read AGENT_MAX_OUTPUT_TOKENS
// from env to stay in sync.
export const MAX_OUTPUT_TOKENS: number = Number(
	process.env.AGENT_MAX_OUTPUT_TOKENS ?? 2048,
);

// parley protocol constants
export const ACK_WINDOW_MS = 15_000;
export const HARD_TIMEOUT_MS = 120_000;
export const MAX_AGENT_ITERATIONS = 15;
export const MAX_VALIDATION_RETRIES = 3;
export const CHAIN_SETTLE_MS = 5_000;
