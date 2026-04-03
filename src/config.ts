import Anthropic from "@anthropic-ai/sdk";

export const MODEL: string = process.env.MODEL || "claude-haiku-4-5-20251001";
export const client: Anthropic = new Anthropic();
