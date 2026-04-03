import type { RoundSynthesizer } from "./types.ts";

export const concatenateSynthesizer: RoundSynthesizer = (
	_roundIndex,
	previousResults,
	_originalPrompt,
) => {
	const responses = previousResults
		.map((r) => `[${r.agentName}]: ${r.response.payload}`)
		.join("\n\n");

	return `Previous round responses:\n${responses}\n\nBased on these responses, continue the conversation.`;
};

export const summarySynthesizer: RoundSynthesizer = (
	_roundIndex,
	previousResults,
	originalPrompt,
) => {
	const responses = previousResults
		.map((r) => `- ${r.agentName}: ${r.response.payload}`)
		.join("\n");

	return `The original question was: "${originalPrompt}"

Here is a summary of agent responses so far:
${responses}

Please provide a deeper analysis building on these points.`;
};

export const debateSynthesizer: RoundSynthesizer = (
	_roundIndex,
	previousResults,
	_originalPrompt,
) => {
	const responses = previousResults
		.map((r) => `[${r.agentName}] said: ${r.response.payload}`)
		.join("\n\n");

	return `The following agents provided different perspectives:\n${responses}\n\nPlease respond to their points and provide your updated analysis.`;
};
