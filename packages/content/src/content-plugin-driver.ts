import {
	type BaseHookContext,
	createPluginValidator,
	type EventBus,
	HookContextProvider,
	type Plugin,
	type PluginDriver,
	type PluginError,
} from "@bluecadet/launchpad-utils";
import type { ResultAsync } from "neverthrow";
import type { ResolvedContentConfig } from "./content-config.js";
import type { DataStore } from "./utils/data-store.js";

export class ContentError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "ContentError";
	}
}

export type ContentHookContext = {
	data: DataStore;
	contentOptions: ResolvedContentConfig;
	paths: {
		getDownloadPath: (source?: string) => string;
		getTempPath: (source?: string) => string;
		getBackupPath: (source?: string) => string;
	};
};

export type CombinedContentHookContext = BaseHookContext & ContentHookContext;

export type ContentHooks = {
	onSetupError: (ctx: CombinedContentHookContext, error: ContentError) => void | PromiseLike<void>;
	onContentFetchSetup: (ctx: CombinedContentHookContext) => void | PromiseLike<void>;
	onContentFetchDone: (ctx: CombinedContentHookContext) => void | PromiseLike<void>;
	onContentFetchError: (
		ctx: CombinedContentHookContext,
		error: ContentError,
	) => void | PromiseLike<void>;
};

export type ContentPlugin<T extends Partial<ContentHooks> = Partial<ContentHooks>> = Plugin<
	ContentHooks,
	T
>;

export function defineContentPlugin<T extends Partial<ContentHooks>>(
	plugin: ContentPlugin<T>,
): ContentPlugin<T> {
	return plugin;
}

export const contentPluginSchema = createPluginValidator<ContentHooks>([
	"onSetupError",
	"onContentFetchSetup",
	"onContentFetchDone",
	"onContentFetchError",
]);

export class ContentPluginDriver extends HookContextProvider<ContentHooks, ContentHookContext> {
	#dataStore: DataStore;
	#options: ResolvedContentConfig;
	#pathGetters: {
		getDownloadPath: (source?: string) => string;
		getTempPath: (source?: string, pluginName?: string) => string;
		getBackupPath: (source?: string) => string;
	};
	#eventBus?: EventBus;

	constructor(
		wrappee: PluginDriver<ContentHooks>,
		{
			dataStore,
			options,
			paths,
		}: {
			dataStore: DataStore;
			options: ResolvedContentConfig;
			paths: {
				getDownloadPath: (source?: string) => string;
				getTempPath: (source?: string, pluginName?: string) => string;
				getBackupPath: (source?: string) => string;
			};
		},
	) {
		super(wrappee);
		this.#dataStore = dataStore;
		this.#options = options;
		this.#pathGetters = paths;
	}

	setEventBus(eventBus: EventBus): void {
		this.#eventBus = eventBus;
	}

	override _getPluginContext(plugin: ContentPlugin) {
		return {
			data: this.#dataStore,
			contentOptions: this.#options,
			paths: {
				getDownloadPath: this.#pathGetters.getDownloadPath,
				getBackupPath: this.#pathGetters.getBackupPath,
				// temp path is plugin-specific
				getTempPath: (source?: string) => this.#pathGetters.getTempPath(source, plugin.name),
			},
		};
	}

	override runHookSequential<K extends keyof ContentHooks>(
		hookName: K,
		...additionalArgs: Parameters<ContentHooks[K]> extends [unknown, ...infer R] ? R : never
	): ResultAsync<void, PluginError> {
		// Get all plugins that have this hook
		const pluginsWithHook = this.plugins.filter((p) => p.hooks[hookName]);

		// Run each plugin's hook sequentially with event emissions
		let result = super.runHookSequential(hookName, ...additionalArgs);

		// Wrap with event emissions if we have an EventBus
		if (this.#eventBus && pluginsWithHook.length > 0) {
			for (const plugin of pluginsWithHook) {
				const startTime = Date.now();
				this.#eventBus.emit("content:plugin:start", {
					pluginName: plugin.name,
				});

				result = result
					.andTee(() => {
						this.#eventBus?.emit("content:plugin:done", {
							pluginName: plugin.name,
							duration: Date.now() - startTime,
						});
					})
					.orElse((error) => {
						this.#eventBus?.emit("content:plugin:error", {
							pluginName: plugin.name,
							error,
						});
						throw error;
					});
			}
		}

		return result;
	}
}
