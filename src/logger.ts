import { writeFileSync } from "node:fs";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVELS: Record<LogLevel, number> = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
};

const LOG_FILE = process.env.LOG_FILE || "./protocol.json";
const LOG_LEVEL: LogLevel =
	(process.env.LOG_LEVEL as LogLevel) in LEVELS
		? (process.env.LOG_LEVEL as LogLevel)
		: "DEBUG";

interface LogEntry {
	timestamp: string;
	level: LogLevel;
	component: string;
	event: string;
	data: Record<string, unknown>;
}

const entries: LogEntry[] = [];

function flush(): void {
	writeFileSync(LOG_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

function write(entry: LogEntry): void {
	entries.push(entry);
	flush();
}

function shouldLog(level: LogLevel): boolean {
	return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function logAt(level: LogLevel) {
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

export const log = {
	debug: logAt("DEBUG"),
	info: logAt("INFO"),
	warn: logAt("WARN"),
	error: logAt("ERROR"),
};
