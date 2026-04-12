/**
 * Runs async tasks with a concurrency limit.
 * Returns results in the original task order.
 */
export async function runPool<T>(
	tasks: (() => Promise<T>)[],
	concurrency: number,
	onComplete?: (result: T, index: number) => void,
): Promise<T[]> {
	const results = new Array<T>(tasks.length);
	let next = 0;

	async function worker(): Promise<void> {
		while (next < tasks.length) {
			const i = next++;
			const result = await tasks[i]();
			results[i] = result;
			onComplete?.(result, i);
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, tasks.length) },
		() => worker(),
	);
	await Promise.all(workers);
	return results;
}
