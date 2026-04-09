<script lang="ts">
	interface Props {
		disabled: boolean;
		onSend: (message: string) => void;
	}

	let { disabled, onSend }: Props = $props();
	let text = $state('');

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function submit() {
		const trimmed = text.trim();
		if (!trimmed || disabled) return;
		text = '';
		onSend(trimmed);
	}
</script>

<div class="border-t border-zinc-700 bg-zinc-800 p-4">
	<div class="flex gap-3 max-w-4xl mx-auto">
		<textarea
			class="flex-1 bg-zinc-700 text-zinc-100 text-sm rounded-lg px-4 py-3 resize-none border border-zinc-600 focus:outline-none focus:border-indigo-400 placeholder-zinc-500"
			rows="1"
			placeholder={disabled ? 'Waiting for response...' : 'Type a message...'}
			bind:value={text}
			onkeydown={handleKeydown}
			{disabled}
		></textarea>
		<button
			class="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
			onclick={submit}
			disabled={disabled || !text.trim()}
		>
			Send
		</button>
	</div>
</div>
