export interface LogMethod {
	(message: string, ...meta: unknown[]): void;
	(...meta: unknown[]): void;
}

/*
 * Logger interface for subsystems.
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
