import Anthropic from "@anthropic-ai/sdk";

export const MODEL: string = process.env.MODEL || "claude-sonnet-4-6";
export const client: Anthropic = new Anthropic();
