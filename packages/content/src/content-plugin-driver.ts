import {
	type BaseHookContext,
	HookContextProvider,
	type HookSet,
	type Logger,
	type Plugin,
	type PluginDriver,
	createPluginValidator,
} from "@bluecadet/launchpad-utils";
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

export interface CoreContentHookArgs {
	onSetupError: ContentError;
	onContentFetchSetup: undefined;
	onContentFetchDone: undefined;
	onContentFetchError: ContentError;
}

export interface ContentHookArgs extends CoreContentHookArgs {}

export type CombinedContentHookContext = BaseHookContext<ContentHookArgs> & ContentHookContext;

export type ContentPlugin = Plugin<ContentHookArgs, CombinedContentHookContext>;

export function defineContentPlugin(plugin: ContentPlugin): ContentPlugin {
	return plugin;
}

export const contentPluginSchema = createPluginValidator<
	ContentHookArgs,
	CombinedContentHookContext
>();

export class ContentPluginDriver extends HookContextProvider<
	ContentHookArgs,
	CombinedContentHookContext
> {
	#dataStore: DataStore;
	#options: ResolvedContentConfig;
	#pathGetters: {
		getDownloadPath: (source?: string) => string;
		getTempPath: (source?: string, pluginName?: string) => string;
		getBackupPath: (source?: string) => string;
	};

	constructor(
		wrappee: PluginDriver<ContentHookArgs, CombinedContentHookContext>,
		{
			dataStore,
			options,
			paths,
			logger,
		}: {
			dataStore: DataStore;
			options: ResolvedContentConfig;
			logger: Logger;
			paths: {
				getDownloadPath: (source?: string) => string;
				getTempPath: (source?: string, pluginName?: string) => string;
				getBackupPath: (source?: string) => string;
			};
		},
	) {
		super(wrappee, logger);
		this.#dataStore = dataStore;
		this.#options = options;
		this.#pathGetters = paths;
	}

	override _getPluginContext(plugin: ContentPlugin) {
		return {
			...this._getBaseHookContext(plugin),
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
}
