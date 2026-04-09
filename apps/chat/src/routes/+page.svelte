<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import ChatMessageBubble from '$lib/components/ChatMessage.svelte';
	import ChatInput from '$lib/components/ChatInput.svelte';
	import LoadingIndicator from '$lib/components/LoadingIndicator.svelte';
	import { fetchProtocols, initSession, sendMessage } from '$lib/api';
	import type { ChatMessage, AgentInfo, ProtocolInfo } from '$lib/types';

	let sessionId = $state<string | null>(null);
	let agents = $state<AgentInfo[]>([]);
	let messages = $state<ChatMessage[]>([]);
	let isLoading = $state(false);
	let protocols = $state<ProtocolInfo[]>([]);
	let currentProtocol = $state('simple');

	let chatContainer: HTMLDivElement;

	async function scrollToBottom() {
		await tick();
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}

	async function initializeSession(protocolId: string) {
		sessionId = null;
		agents = [];
		messages = [];
		isLoading = false;
		currentProtocol = protocolId;

		const session = await initSession(protocolId, 'User');
		sessionId = session.sessionId;
		agents = session.agents;
	}

	async function handleSend(message: string) {
		if (!sessionId) return;

		messages.push({
			id: crypto.randomUUID(),
			role: 'user',
			content: message,
			timestamp: new Date().toISOString(),
		});
		isLoading = true;
		await scrollToBottom();

		try {
			const results = await sendMessage(sessionId, message);
			for (const result of results) {
				messages.push({
					id: crypto.randomUUID(),
					role: 'agent',
					content: result.response.payload,
					rawPayload: result.response.payload,
					agentName: result.agentName,
					skills: result.skills,
					usage: result.usage,
					model: result.model,
					durationMs: result.durationMs,
					cost: result.cost,
					timestamp: result.response.timestamp,
				});
			}
		} catch (err) {
			messages.push({
				id: crypto.randomUUID(),
				role: 'agent',
				content: `Error: ${err instanceof Error ? err.message : 'Request failed'}`,
				agentName: 'System',
				timestamp: new Date().toISOString(),
			});
		} finally {
			isLoading = false;
			await scrollToBottom();
		}
	}

	async function handleProtocolChange(protocolId: string) {
		await initializeSession(protocolId);
	}

	onMount(async () => {
		protocols = await fetchProtocols();
		if (protocols.length > 0) {
			const defaultId = protocols.find(p => p.id === 'simple')?.id ?? protocols[0].id;
			await initializeSession(defaultId);
		}
	});
</script>

<Sidebar
	{protocols}
	{currentProtocol}
	{agents}
	onProtocolChange={handleProtocolChange}
/>

<main class="flex-1 flex flex-col min-w-0">
	<div
		class="flex-1 overflow-y-auto p-6"
		bind:this={chatContainer}
	>
		{#if messages.length === 0 && !isLoading}
			<div class="h-full flex items-center justify-center">
				<p class="text-zinc-500 text-sm">Send a message to start chatting with the agents.</p>
			</div>
		{/if}

		{#each messages as message (message.id)}
			<ChatMessageBubble {message} />
		{/each}

		{#if isLoading}
			<LoadingIndicator />
		{/if}
	</div>

	<ChatInput
		disabled={isLoading || !sessionId}
		onSend={handleSend}
	/>
</main>
