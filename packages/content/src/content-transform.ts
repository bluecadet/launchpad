import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { ResolvedContentConfig } from "./content-config.js";
import type { DataStore } from "./utils/data-store.js";
import type { PathsHelper } from "./utils/paths-helper.js";

export class ContentError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "ContentError";
	}
}

export type ContentTransformContext = {
	data: DataStore;
	logger: Logger;
	contentOptions: ResolvedContentConfig;
	/**
	 * Path helpers. `getTempPath` is pre-bound to this transform's name
	 * (e.g. `.launchpad/tmp/<transformName>/<sourceId>`).
	 */
	paths: PathsHelper;
	/**
	 * Event bus for transforms that need to emit TTY progress events (e.g. mediaDownloader, sharp).
	 * Transforms should NOT emit `content:transform:*` lifecycle events — those are handled by
	 * the runTransformsStage loop. The event bus is provided for TTY progress (log:tty) only.
	 */
	eventBus: EventBus;
};

export type ContentTransform = {
	name: string;
	apply: (ctx: ContentTransformContext) => Promise<void>;
};

/** Type-safe factory for content transforms. */
export function defineContentTransform(transform: ContentTransform): ContentTransform {
	return transform;
}
