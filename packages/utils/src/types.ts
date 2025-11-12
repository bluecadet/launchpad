// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface LaunchpadConfig {}

export interface LaunchpadEvents {
	"log:info": {
		message: string;
		// any additional metadata
		[key: string]: unknown;
	};
	"log:warn": {
		message: string;
		// any additional metadata
		[key: string]: unknown;
	};
	"log:error": {
		message: string;
		// any additional metadata
		[key: string]: unknown;
	};
	"log:debug": {
		message: string;
		// any additional metadata
		[key: string]: unknown;
	};
	/**
	 * Event for updating TTY fixed console messages.
	 * Payload contains the message to display (including any ANSI codes).
	 */
	"log:tty": {
		message: string;
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
