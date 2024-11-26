import chalk from "chalk";
import { ResultAsync, okAsync } from "neverthrow";
import { z } from "zod";
import type { Logger } from "./log-manager.js";
import { onExit } from "./on-exit.js";

export class PluginError extends Error {
	pluginId?: string;
	declare cause: unknown;

	constructor(cause: unknown, { pluginId }: { pluginId: string }) {
		if (cause instanceof Error) {
			super(cause.message);
			this.cause = cause;
		} else {
			super(String(cause));
			this.cause = cause;
		}

		this.pluginId = pluginId;
	}
}

export interface BaseHookContext {
	logger: Logger;
	abortSignal: AbortSignal;
}

export type HookSet = Record<
	string,
	// biome-ignore lint/suspicious/noExplicitAny: required for derived context types
	(ctx: any, ...args: never[]) => void | PromiseLike<void>
>;

export type Plugin<
	AllowedHooks extends HookSet,
	ActualHooks extends Partial<AllowedHooks> = Partial<AllowedHooks>,
> = {
	name: string;
	hooks: {
		[K in keyof ActualHooks]: K extends keyof AllowedHooks ? ActualHooks[K] : never;
	};
};

type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : [];

type KeysWithFullContext<T extends HookSet, C> = {
	[K in keyof T]: C extends Parameters<T[K]>[0] ? K : never;
}[keyof T];

export function createPluginValidator<T extends HookSet>(validHookKeys: (keyof T)[]) {
	return z.object({
		name: z.string(),
		hooks: z.record(z.string() as z.ZodType<keyof T>, z.function()).refine(
			(hooks) => Object.keys(hooks).every((hook) => validHookKeys.includes(hook as keyof T)),
			(val) => ({
				message: `Invalid hooks found: ${Object.keys(val).join(", ")}`,
			}),
		),
	}) as z.ZodType<Plugin<T>>;
}

export default class PluginDriver<T extends HookSet> {
	#plugins: Plugin<T>[] = [];
	readonly #baseHookContexts = new Map<Plugin<T>, BaseHookContext>();
	readonly #baseLogger: Logger;
	readonly #abortController = new AbortController();

	get plugins(): ReadonlyArray<Plugin<T>> {
		return this.#plugins;
	}

	constructor(baseLogger: Logger, plugins?: Plugin<T>[]) {
		this.#baseLogger = baseLogger;

		if (plugins) {
			this.add(plugins);
		}

		onExit(() => {
			this.#abortController.abort();
		});
	}

	add(plugins: Plugin<T> | Plugin<T>[]): void {
		const pluginArray = Array.isArray(plugins) ? plugins : [plugins];

		for (const plugin of pluginArray) {
			this.#plugins.push(plugin);
			this.#baseHookContexts.set(plugin, {
				logger: this.#baseLogger.child({ module: `plugin:${plugin.name}` }),
				abortSignal: this.#abortController.signal,
			});
		}
	}

	#getBaseContext(plugin: Plugin<T>): BaseHookContext {
		const ctx = this.#baseHookContexts.get(plugin);

		if (!ctx) {
			throw new Error(`Plugin not found: ${plugin.name}`);
		}

		return ctx;
	}

	#getHookCalls<K extends keyof T>(
		hookName: K,
		contextGetter: (plugin: Plugin<T>) => Omit<Parameters<T[K]>[0], keyof BaseHookContext>,
		additionalArgs: Tail<Parameters<T[K]>>,
	): (() => ResultAsync<void, PluginError>)[] {
		return this.#plugins.map((plugin) => {
			const hook = plugin.hooks[hookName];
			if (hook) {
				const context = {
					...this.#getBaseContext(plugin),
					...contextGetter(plugin),
				};

				const wrappedHookCall = async () => {
					await hook(context, ...additionalArgs);
				};

				return () =>
					ResultAsync.fromPromise(wrappedHookCall(), (e) => {
						this.#getBaseContext(plugin).logger.error(
							chalk.red(`Error in hook ${String(hookName)}`),
						);
						this.#getBaseContext(plugin).logger.error(chalk.red(e));
						return new PluginError(e, { pluginId: plugin.name });
					});
			}

			return () => okAsync(undefined);
		});
	}

	_runHookSequentialWithCtx<K extends keyof T>(
		hookName: K,
		contextGetter: (plugin: Plugin<T>) => Omit<Parameters<T[K]>[0], keyof BaseHookContext>,
		additionalArgs: Tail<Parameters<T[K]>>,
	): ResultAsync<void, PluginError> {
		let result: ResultAsync<void, PluginError> = okAsync(undefined);

		const hookCalls = this.#getHookCalls(hookName, contextGetter, additionalArgs);

		for (const hookCall of hookCalls) {
			result = result.andThen(() => hookCall());
		}

		return result;
	}

	_runHookParallelWithCtx<K extends keyof T>(
		hookName: K,
		contextGetter: (plugin: Plugin<T>) => Omit<Parameters<T[K]>[0], keyof BaseHookContext>,
		additionalArgs: Tail<Parameters<T[K]>>,
	): ResultAsync<void, PluginError[]> {
		const hookCalls = this.#getHookCalls(hookName, contextGetter, additionalArgs);
		return ResultAsync.combineWithAllErrors(hookCalls.map((call) => call())).map(() => undefined);
	}

	async runHookSequential<K extends KeysWithFullContext<T, BaseHookContext>>(
		hookName: K,
		...additionalArgs: Tail<Parameters<T[K]>>
	): Promise<void> {
		for (const plugin of this.#plugins) {
			const hook = plugin.hooks[hookName];
			if (hook) {
				await hook(this.#getBaseContext(plugin), ...additionalArgs);
			}
		}
	}
}

export class HookContextProvider<T extends HookSet, C> {
	readonly #innerDriver: PluginDriver<T>;

	constructor(innerDriver: PluginDriver<T>) {
		this._initialize(innerDriver.plugins);
		this.#innerDriver = innerDriver;
		this._getPluginContext = this._getPluginContext.bind(this);
	}

	get plugins(): ReadonlyArray<Plugin<T>> {
		return this.#innerDriver.plugins;
	}

	protected _initialize(plugins: ReadonlyArray<Plugin<T>>): void {
		// implement in subclass
	}

	protected _getPluginContext(plugin: Plugin<T>): C {
		throw new Error("_getPluginContext Not implemented");
	}

	add(plugins: Plugin<T> | Plugin<T>[]): void {
		const pluginArray = Array.isArray(plugins) ? plugins : [plugins];
		this._initialize(pluginArray);
		this.#innerDriver.add(plugins);
	}

	runHookSequential<K extends KeysWithFullContext<T, C & BaseHookContext>>(
		hookName: K,
		...additionalArgs: Tail<Parameters<T[K]>>
	): ResultAsync<void, PluginError> {
		return this.#innerDriver._runHookSequentialWithCtx(
			hookName,
			this._getPluginContext,
			additionalArgs,
		);
	}

	runHookParallel<K extends KeysWithFullContext<T, C & BaseHookContext>>(
		hookName: K,
		...additionalArgs: Tail<Parameters<T[K]>>
	): ResultAsync<void, PluginError[]> {
		return this.#innerDriver._runHookParallelWithCtx(
			hookName,
			this._getPluginContext,
			additionalArgs,
		);
	}
}
