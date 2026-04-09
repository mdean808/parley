export const PRICING: Record<string, { input: number; output: number }> = {
	"claude-haiku-4-5-20251001": { input: 1, output: 5 },
	"claude-sonnet-4-5-20250929": { input: 3, output: 15 },
	"claude-sonnet-4-6": { input: 3, output: 15 },
};

export function computeCost(
	inputTokens: number,
	outputTokens: number,
	model: string,
): number {
	const pricing = PRICING[model];
	if (!pricing) return 0;
	return (
		(inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
	);
}
