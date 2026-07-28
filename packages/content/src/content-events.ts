// need to import so declaration merging works
import "@bluecadet/launchpad-utils/types";
import type { Manifest } from "./manifest.js";

/**
 * Content plugin events.
 *
 * This file uses TypeScript declaration merging to add content-specific
 * events to the LaunchpadEvents interface from the controller package.
 *
 * When @bluecadet/launchpad-controller is installed, these events become
 * fully type-safe. When it's not installed, the events can still be emitted
 * but without type checking.
 */

/** Content plugin event types for use with generic EventBus. */
export type ContentEvents = {
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

	/** Emitted immediately after the manifest swap under versioned output mode. */
	"content:version:promoted": {
		versionId: string;
		versionPath: string;
		generatedAt: string;
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
		/**
		 * Absolute path to the staged file written during the current fetch run.
		 * The staged tree is promoted after a successful run.
		 */
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
};

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents extends ContentEvents {}
}

/** Payload of the `content:version:promoted` event. */
export type VersionPromotedPayload = ContentEvents["content:version:promoted"];

/**
 * Single source of truth for the `content:version:promoted` payload.
 *
 * Two sites emit this event — the promote path right after the manifest swap, and the
 * plugin's startup announcement for an already-active version — and both derive the
 * payload from the same manifest fields here so the two can never drift.
 */
export function buildVersionPromotedPayload(manifest: Manifest): VersionPromotedPayload {
	return {
		versionId: manifest.versionId,
		versionPath: manifest.versionPath,
		generatedAt: manifest.generatedAt,
	};
}
