<script lang="ts">
import { onMount, tick } from "svelte";
import {
	connectToEvents,
	fetchProtocols,
	initSession,
	sendMessage,
} from "$lib/api";
import ChatInput from "$lib/components/ChatInput.svelte";
import ChatMessageBubble from "$lib/components/ChatMessage.svelte";
import LoadingIndicator from "$lib/components/LoadingIndicator.svelte";
import Sidebar from "$lib/components/Sidebar.svelte";
import type {
	AgentInfo,
	ChatMessage,
	ChatStreamEvent,
	ProtocolInfo,
} from "$lib/types";

let sessionId = $state<string | null>(null);
let agents = $state<AgentInfo[]>([]);
let messages = $state<ChatMessage[]>([]);
let protocols = $state<ProtocolInfo[]>([]);
let currentProtocol = $state("simple");
let pendingCount = $state(0);

let chatContainer: HTMLDivElement;
let sseController: AbortController | null = null;
const seenIds = new Set<string>();

async function scrollToBottom() {
	await tick();
	if (chatContainer) {
		chatContainer.scrollTop = chatContainer.scrollHeight;
	}
}

function handleStreamEvent(event: ChatStreamEvent) {
	if (event.type === "protocol_event") {
		const { agentName, eventType, message, meta } = event;

		if (eventType === "state_change" && message) {
			if (seenIds.has(message.id)) return;
			seenIds.add(message.id);

			if (message.type === "RESPONSE") {
				messages.push({
					id: message.id,
					role: "agent",
					messageType: "RESPONSE",
					content: message.payload,
					agentName,
					skills: meta?.skills,
					usage: meta?.usage,
					model: meta?.model,
					durationMs: meta?.durationMs,
					toonMessage: message.toon,
					timestamp: message.timestamp,
				});
			} else if (message.type === "ACK" || message.type === "PROCESS") {
				messages.push({
					id: message.id,
					role: "trace",
					messageType: message.type,
					content: message.payload,
					agentName,
					toonMessage: message.toon,
					timestamp: message.timestamp,
				});
			}

			scrollToBottom();
		} else if (eventType === "decline") {
			// Optionally show decline as trace
		}
	} else if (event.type === "results") {
		// Results from sendRequest — used by simple protocol (v2 may be empty)
		const { results, requestToon } = event.data;

		if (requestToon) {
			// Update the most recent user message's toonMessage
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].role === "user") {
					messages[i].toonMessage = requestToon;
					break;
				}
			}
		}

		for (const result of results) {
			const id = result.response.id || crypto.randomUUID();
			if (seenIds.has(id)) continue;
			seenIds.add(id);

			messages.push({
				id,
				role: "agent",
				messageType: "RESPONSE",
				content: result.response.payload,
				agentName: result.agentName,
				skills: result.skills,
				usage: result.usage,
				model: result.model,
				durationMs: result.durationMs,
				cost: result.cost,
				timestamp: result.response.timestamp,
			});
		}

		pendingCount = Math.max(0, pendingCount - 1);
		scrollToBottom();
	} else if (event.type === "error") {
		messages.push({
			id: crypto.randomUUID(),
			role: "agent",
			content: `Error: ${event.message}`,
			agentName: "System",
			timestamp: new Date().toISOString(),
		});
		pendingCount = Math.max(0, pendingCount - 1);
		scrollToBottom();
	}
}

async function initializeSession(protocolId: string) {
	// Clean up previous SSE connection
	sseController?.abort();
	sseController = null;

	sessionId = null;
	agents = [];
	messages = [];
	pendingCount = 0;
	seenIds.clear();
	currentProtocol = protocolId;

	const session = await initSession(protocolId, "User");
	sessionId = session.sessionId;
	agents = session.agents;

	// Open persistent SSE connection
	sseController = connectToEvents(session.sessionId, handleStreamEvent);
}

async function handleSend(message: string) {
	if (!sessionId) return;

	messages.push({
		id: crypto.randomUUID(),
		role: "user",
		content: message,
		timestamp: new Date().toISOString(),
	});
	pendingCount++;
	await scrollToBottom();

	// Fire-and-forget — results arrive via SSE
	sendMessage(sessionId, message).catch((err) => {
		messages.push({
			id: crypto.randomUUID(),
			role: "agent",
			content: `Error: ${err instanceof Error ? err.message : "Request failed"}`,
			agentName: "System",
			timestamp: new Date().toISOString(),
		});
		pendingCount = Math.max(0, pendingCount - 1);
	});
}

async function handleProtocolChange(protocolId: string) {
	await initializeSession(protocolId);
}

onMount(async () => {
	protocols = await fetchProtocols();
	if (protocols.length > 0) {
		const defaultId =
			protocols.find((p) => p.id === "simple")?.id ?? protocols[0].id;
		await initializeSession(defaultId);
	}

	return () => {
		sseController?.abort();
	};
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
		{#if messages.length === 0 && pendingCount === 0}
			<div class="h-full flex items-center justify-center">
				<p class="text-zinc-500 text-sm">Send a message to start chatting with the agents.</p>
			</div>
		{/if}

		{#each messages as message (message.id)}
			<ChatMessageBubble {message} />
		{/each}

		{#if pendingCount > 0}
			<LoadingIndicator />
		{/if}
	</div>

	<ChatInput
		disabled={!sessionId}
		onSend={handleSend}
	/>
</main>
