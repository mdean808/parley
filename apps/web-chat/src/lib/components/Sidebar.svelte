<script lang="ts">
import type { AgentInfo, ProtocolInfo } from "$lib/types";

interface Props {
	protocols: ProtocolInfo[];
	currentProtocol: string;
	agents: AgentInfo[];
	coltOnly: boolean;
	onProtocolChange: (protocolId: string) => void;
	onColtOnlyChange: (checked: boolean) => void;
}

let {
	protocols,
	currentProtocol,
	agents,
	coltOnly,
	onProtocolChange,
	onColtOnlyChange,
}: Props = $props();

const agentColors: Record<string, string> = {
	Atlas: "bg-blue-400",
	Sage: "bg-green-400",
	Bolt: "bg-yellow-400",
	Colt: "bg-orange-400",
};

function getAgentColor(name: string): string {
	for (const [key, color] of Object.entries(agentColors)) {
		if (name.startsWith(key)) return color;
	}
	return "bg-zinc-400";
}
</script>

<aside class="w-64 bg-zinc-800 border-r border-zinc-700 flex flex-col shrink-0">
	<div class="p-4 border-b border-zinc-700">
		<h1 class="text-lg font-semibold text-zinc-100">Agent Chat</h1>
	</div>

	<div class="p-4 border-b border-zinc-700">
		<label class="block text-xs font-medium text-zinc-400 mb-2" for="protocol-select">Protocol</label>
		<select
			id="protocol-select"
			class="w-full bg-zinc-700 text-zinc-100 text-sm rounded px-3 py-2 border border-zinc-600 focus:outline-none focus:border-indigo-400"
			value={currentProtocol}
			onchange={(e) => onProtocolChange(e.currentTarget.value)}
		>
			{#each protocols as proto}
				<option value={proto.id}>{proto.label}</option>
			{/each}
		</select>
	</div>

	<div class="px-4 py-3 border-b border-zinc-700">
		<label class="flex items-center gap-2 cursor-pointer">
			<input
				type="checkbox"
				checked={coltOnly}
				onchange={(e) => onColtOnlyChange(e.currentTarget.checked)}
				class="rounded bg-zinc-700 border-zinc-600 text-indigo-500 focus:ring-indigo-400"
			/>
			<span class="text-sm text-zinc-300">Colt Only</span>
		</label>
		{#if coltOnly}
			<p class="text-xs text-zinc-500 mt-1">All messages route through Colt, who can delegate to other agents.</p>
		{/if}
	</div>

	<div class="p-4 flex-1 overflow-y-auto">
		<h2 class="text-xs font-medium text-zinc-400 mb-3">Agents</h2>
		{#each agents as agent}
			<div class="mb-3 {coltOnly && !agent.name.startsWith('Colt') ? 'opacity-40' : ''}">
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full {getAgentColor(agent.name)}"></span>
					<span class="text-sm font-medium text-zinc-200">{agent.name}</span>
				</div>
				<div class="ml-4 mt-1 flex flex-wrap gap-1">
					{#each agent.skills as skill}
						<span class="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{skill}</span>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</aside>
