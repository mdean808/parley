import { mkdir, writeFile } from "node:fs/promises";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Numeric priority for each log level, used for filtering. */
const LEVELS: Record<LogLevel, number> = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
};

const LOG_DIR: string = process.env.LOG_DIR ||
	new URL("../../logs", import.meta.url).pathname;
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = `${LOG_DIR}/${timestamp}.json`;
const LOG_LEVEL: LogLevel =
	(process.env.LOG_LEVEL as LogLevel) in LEVELS
		? (process.env.LOG_LEVEL as LogLevel)
		: "DEBUG";

// Ensure log directory exists
await mkdir(LOG_DIR, { recursive: true });

/** A structured log entry written to the protocol JSON log file. */
interface LogEntry {
	timestamp: string;
	level: LogLevel;
	component: string;
	event: string;
	data: Record<string, unknown>;
}

const entries: LogEntry[] = [];

/** Writes all accumulated log entries to the log file. */
async function flush(): Promise<void> {
	await writeFile(LOG_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

/**
 * Appends a log entry to the in-memory buffer and flushes to disk.
 * @param entry - The structured log entry to write.
 */
function write(entry: LogEntry): void {
	entries.push(entry);
	flush();
}

/**
 * Checks whether a given log level meets the configured minimum threshold.
 * @param level - The log level to check.
 * @returns Whether messages at this level should be logged.
 */
function shouldLog(level: LogLevel): boolean {
	return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

/**
 * Creates a logging function for a specific log level.
 * The returned function accepts a component name, event name, and optional data object.
 * @param level - The log level for the returned logger function.
 * @returns A function that logs structured entries at the given level.
 */
function logAt(
	level: LogLevel,
): (component: string, event: string, data?: Record<string, unknown>) => void {
	return (
		component: string,
		event: string,
		data: Record<string, unknown> = {},
	): void => {
		if (!shouldLog(level)) return;
		write({
			timestamp: new Date().toISOString(),
			level,
			component,
			event,
			data,
		});
	};
}

// Write session marker on startup
write({
	timestamp: new Date().toISOString(),
	level: "INFO",
	component: "init",
	event: "session_start",
	data: { logFile: LOG_FILE, logLevel: LOG_LEVEL },
});

/** Structured JSON logger with methods for each log level. */
export const log = {
	debug: logAt("DEBUG"),
	info: logAt("INFO"),
	warn: logAt("WARN"),
	error: logAt("ERROR"),
};
