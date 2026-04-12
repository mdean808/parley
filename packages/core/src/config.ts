import Anthropic from "@anthropic-ai/sdk";

export const MODEL: string = process.env.MODEL || "claude-sonnet-4-6";
export const client: Anthropic = new Anthropic();

// v2 protocol constants
export const ACK_WINDOW_MS = 15_000;
export const HARD_TIMEOUT_MS = 30_000;
export const MAX_AGENT_ITERATIONS = 15;
export const MAX_VALIDATION_RETRIES = 3;
