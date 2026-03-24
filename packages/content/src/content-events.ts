// need to import so declaration merging works
import "@bluecadet/launchpad-utils/types";

/**
 * Content subsystem events.
 *
 * This file uses TypeScript declaration merging to add content-specific
 * events to the LaunchpadEvents interface from the controller package.
 *
 * When @bluecadet/launchpad-controller is installed, these events become
 * fully type-safe. When it's not installed, the events can still be emitted
 * but without type checking.
 */

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents {
		// Fetch lifecycle
		"content:fetch:start": {
			timestamp: Date;
		};

		"content:fetch:done": {
			sources: string[];
		};

		"content:fetch:error": {
			error: Error;
			source?: string;
		};

		// Source-specific events
		"content:source:start": {
			sourceId: string;
			sourceType: string;
		};

		"content:source:done": {
			sourceId: string;
		};

		"content:source:error": {
			sourceId: string;
			error: Error;
		};

		// Document events
		"content:document:write": {
			sourceId: string;
			documentId: string;
			path: string;
		};

		"content:document:error": {
			sourceId: string;
			documentId: string;
			error: Error;
		};

		// Transform events
		"content:transform:start": {
			transformName: string;
		};

		"content:transform:done": {
			transformName: string;
			duration: number;
		};

		"content:transform:error": {
			transformName: string;
			error: Error;
		};
	}
}
