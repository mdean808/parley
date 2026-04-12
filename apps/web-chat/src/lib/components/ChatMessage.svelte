<script lang="ts">
import { marked } from "marked";
import type { ChatMessage } from "$lib/types";

interface Props {
	message: ChatMessage;
}

let { message }: Props = $props();

let showPayload = $state(false);

const agentBorderColors: Record<string, string> = {
	Atlas: "border-blue-400",
	Sage: "border-green-400",
	Bolt: "border-yellow-400",
};

function getBorderColor(name?: string): string {
	if (!name) return "border-zinc-600";
	for (const [key, color] of Object.entries(agentBorderColors)) {
		if (name.startsWith(key)) return color;
	}
	return "border-zinc-600";
}

function getNameColor(name?: string): string {
	if (!name) return "text-zinc-300";
	if (name.startsWith("Atlas")) return "text-blue-400";
	if (name.startsWith("Sage")) return "text-green-400";
	if (name.startsWith("Bolt")) return "text-yellow-400";
	return "text-zinc-300";
}

function renderMarkdown(text: string): string {
	return marked.parse(text, { async: false }) as string;
}

function formatCost(cost: number): string {
	return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`;
}

function shortId(id: string): string {
	return id.slice(0, 8);
}
</script>

{#snippet infoButton()}
	{#if message.toonMessage}
		<button
			class="text-zinc-500 hover:text-zinc-300 transition-colors relative flex-shrink-0"
			onmouseenter={() => showPayload = true}
			onmouseleave={() => showPayload = false}
		>
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			{#if showPayload}
				<div class="absolute left-6 top-0 z-50 w-[32rem] max-h-80 overflow-auto bg-zinc-800 border border-zinc-600 rounded-lg p-3 shadow-xl text-left">
					<pre class="text-xs text-zinc-300 whitespace-pre-wrap font-mono text-left">{message.toonMessage}</pre>
				</div>
			{/if}
		</button>
	{/if}
{/snippet}

{#if message.role === 'user'}
	<div class="flex justify-end mb-4">
		<div class="max-w-2xl bg-indigo-500/20 border border-indigo-500/30 rounded-lg px-4 py-3">
			<div class="flex items-start gap-2">
				<p class="text-sm text-zinc-100">{message.content}</p>
				{@render infoButton()}
			</div>
		</div>
	</div>
{:else if message.role === 'trace'}
	<div class="mb-1 flex items-center gap-2 text-xs">
		<div class="border-l-2 {getBorderColor(message.agentName)} pl-3 flex items-center gap-2">
			<span class="font-medium {getNameColor(message.agentName)}">{message.agentName}</span>
			<span class="text-zinc-400 font-medium">{message.messageType}</span>
			<span class="text-zinc-600 font-mono">{shortId(message.id)}</span>
			{@render infoButton()}
		</div>
	</div>
{:else}
	<div class="mb-4 max-w-3xl">
		<div class="border-l-2 {getBorderColor(message.agentName)} pl-4">
			<div class="flex items-center gap-2 mb-1">
				<span class="text-sm font-semibold {getNameColor(message.agentName)}">{message.agentName}</span>
				{#if message.messageType}
					<span class="text-xs text-zinc-500 font-medium">{message.messageType}</span>
				{/if}
				<span class="text-xs text-zinc-600 font-mono">{shortId(message.id)}</span>
				{@render infoButton()}
			</div>

			<div class="prose prose-invert prose-sm max-w-none text-zinc-200 message-content">
				{@html renderMarkdown(message.content)}
			</div>

			{#if message.usage || message.cost !== undefined || message.durationMs}
				<div class="mt-2 flex gap-3 text-xs text-zinc-500">
					{#if message.usage}
						<span>{message.usage.inputTokens + message.usage.outputTokens} tokens</span>
					{/if}
					{#if message.cost !== undefined}
						<span>{formatCost(message.cost)}</span>
					{/if}
					{#if message.durationMs}
						<span>{(message.durationMs / 1000).toFixed(1)}s</span>
					{/if}
					{#if message.model}
						<span>{message.model}</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.message-content :global(pre) {
		overflow-x: auto;
		max-height: 20rem;
		font-size: 0.7rem;
		line-height: 1.5;
		border: 1px solid rgb(63 63 70);
		border-radius: 0.5rem;
		padding: 0.75rem;
		background: rgb(24 24 27);
		margin: 0.75rem 0;
	}

	.message-content :global(pre code) {
		font-size: 0.7rem;
	}
</style>
