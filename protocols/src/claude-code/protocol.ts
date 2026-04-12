import { spawnSync } from "node:child_process";
import { MODEL } from "core/config";
import type {
	AgentResult,
	Protocol,
	ProtocolEventHandler,
	ProtocolInit,
	ProtocolMessageHandler,
	SendResult,
} from "core/types";

interface ClaudeCodeOutput {
	result: string;
	session_id: string;
	model: string;
	total_cost_usd: number;
	duration_ms: number;
	is_error: boolean;
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_creation_input_tokens: number;
		cache_read_input_tokens: number;
	};
}

export class ClaudeCodeProtocol implements Protocol {
	private readonly sessions = new Map<string, string>();
	private readonly onEvent?: ProtocolEventHandler;
	private readonly model: string;
	private readonly onMessage?: ProtocolMessageHandler;

	constructor(
		onEvent?: ProtocolEventHandler,
		model?: string,
		onMessage?: ProtocolMessageHandler,
	) {
		this.onEvent = onEvent;
		this.model = model ?? MODEL;
		this.onMessage = onMessage;
	}

	initialize(userName: string): ProtocolInit {
		return {
			userId: "claude-code-user",
			userName,
			agents: [{ name: "Claude Code", skills: ["general"] }],
		};
	}

	async sendRequest(
		_userId: string,
		message: string,
		chainId?: string,
	): Promise<SendResult> {
		this.onEvent?.({
			agentName: "Claude Code",
			type: "tool_use",
			detail: "invoking claude CLI",
		});

		const args = [
			"claude",
			"-p",
			message,
			"--output-format",
			"json",
			"--model",
			this.model,
			"--max-turns",
			"5",
		];

		const sessionId = chainId ? this.sessions.get(chainId) : undefined;
		if (sessionId) {
			args.push("--resume", sessionId);
		}

		const proc = spawnSync(args[0], args.slice(1), { encoding: "utf-8" });
		const stdout = proc.stdout ?? "";

		if (proc.status !== 0) {
			const stderr = proc.stderr ?? "";
			const detail = stderr || stdout || "(no output)";
			throw new Error(`claude CLI failed (exit ${proc.status}): ${detail}`);
		}

		const output: ClaudeCodeOutput = JSON.parse(stdout);
		const resolvedChainId = chainId ?? crypto.randomUUID();
		const requestId = crypto.randomUUID();

		if (output.session_id) {
			this.sessions.set(resolvedChainId, output.session_id);
		}

		if (output.is_error) {
			throw new Error(`claude CLI returned error: ${output.result}`);
		}

		const inputTokens =
			output.usage.input_tokens +
			(output.usage.cache_creation_input_tokens ?? 0) +
			(output.usage.cache_read_input_tokens ?? 0);

		const result: AgentResult = {
			agentName: "Claude Code",
			skills: ["general"],
			response: {
				id: crypto.randomUUID(),
				chainId: resolvedChainId,
				replyTo: undefined,
				timestamp: new Date().toISOString(),
				type: "RESPONSE",
				payload: output.result,
				from: "claude-code",
				to: [_userId],
			},
			usage: {
				inputTokens,
				outputTokens: output.usage.output_tokens,
			},
			model: this.model,
			durationMs: output.duration_ms,
			cost: output.total_cost_usd,
		};

		this.onMessage?.(result, resolvedChainId);

		return { chainId: resolvedChainId, requestId, settled: Promise.resolve() };
	}
}
