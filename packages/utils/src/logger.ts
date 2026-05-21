export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose";

export type LogEventPayload = {
	message: string; // formatted message string
	args: Array<unknown>; // original arguments passed to the log method
	module?: string;
};

export interface LogMethod {
	(message: string, ...meta: unknown[]): void;
	(...meta: unknown[]): void;
}

/*
 * Logger interface for plugins.
 * This is a simplified subset of Winston's Logger.
 */
export type Logger = {
	info: LogMethod;
	warn: LogMethod;
	error: LogMethod;
	debug: LogMethod;
	verbose: LogMethod;
	child: (moduleName: string) => Logger;
};
