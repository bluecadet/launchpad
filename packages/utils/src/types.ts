// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface LaunchpadConfig {}

export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose";

export type LogEventPayload = {
	message: string; // formatted message string
	args: Array<unknown>; // original arguments passed to the log method
	module?: string;
};

export interface LaunchpadEvents {
	"log:error": LogEventPayload;
	"log:warn": LogEventPayload;
	"log:info": LogEventPayload;
	"log:debug": LogEventPayload;
	"log:verbose": LogEventPayload;
	/**
	 * Event for updating TTY fixed console messages.
	 * Payload contains the message to display (including any ANSI codes).
	 */
	"log:tty": {
		message: string | null;
	};
	/**
	 * Event for closing TTY fixed console messages.
	 * No payload.
	 */
	"log:tty:close": {
		// no payload
		[k: string]: never;
	};
	// other events can be added via declaration merging
}

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface SubsystemsState {}
