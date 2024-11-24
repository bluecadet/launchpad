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

type ArgTuple<Arg> = Arg extends undefined ? [] : [Arg];

export interface BaseHookContext<Args> {
	logger: Logger;
	abortSignal: AbortSignal;
	emit: <K extends keyof Args>(
		event: K,
		...args: ArgTuple<Args[K]>
	) => ResultAsync<unknown, unknown>;
}

type HookFunction<Context, Arg> = (
	ctx: Context,
	...args: ArgTuple<Arg>
) => void | Promise<void> | PromiseLike<void>;

export type HookSet<HookArgs, Context> = {
	[K in keyof HookArgs]: HookFunction<Context, HookArgs[K]>;
};

export type Plugin<HookArgs, Context> = {
	name: string;
	hooks: {
		[K in keyof HookArgs]?: K extends keyof HookArgs ? HookSet<HookArgs, Context>[K] : never;
	};
};

export function createPluginValidator<Args, Ctx>() {
	return z.object({
		name: z.string(),
		hooks: z.record(z.string(), z.function()),
	}) as unknown as z.ZodType<Plugin<Args, Ctx>>;
}

export default class PluginDriver<Args, Ctx> {
	#plugins: Plugin<Args, Ctx>[] = [];

	get plugins(): ReadonlyArray<Plugin<Args, Ctx>> {
		return this.#plugins;
	}

	constructor(plugins?: Plugin<Args, Ctx>[]) {
		if (plugins) {
			this.add(plugins);
		}
	}

	add(plugins: Plugin<Args, Ctx> | Plugin<Args, Ctx>[]): void {
		const pluginArray = Array.isArray(plugins) ? plugins : [plugins];

		for (const plugin of pluginArray) {
			this.#plugins.push(plugin);
		}
	}

	#getHookCalls<K extends keyof Args>(
		hookName: K,
		contextGetter: (plugin: Plugin<Args, Ctx>) => Ctx,
		...additionalArgs: ArgTuple<Args[K]>
	): (() => ResultAsync<void, PluginError>)[] {
		return this.#plugins.map((plugin) => {
			const hook = plugin.hooks[hookName] as HookFunction<Ctx, Args[K]> | undefined;
			if (hook) {
				const context = contextGetter(plugin);

				const wrappedHookCall = async () => {
					await hook(context, ...additionalArgs);
				};

				return () =>
					ResultAsync.fromPromise(wrappedHookCall(), (e) => {
						return new PluginError(e, { pluginId: plugin.name });
					});
			}

			return () => okAsync(undefined);
		});
	}

	_runHookSequentialWithCtx<K extends keyof Args>(
		hookName: K,
		contextGetter: (plugin: Plugin<Args, Ctx>) => Ctx,
		...additionalArgs: ArgTuple<Args[K]>
	): ResultAsync<void, PluginError> {
		let result: ResultAsync<void, PluginError> = okAsync(undefined);

		const hookCalls = this.#getHookCalls(hookName, contextGetter, ...additionalArgs);

		for (const hookCall of hookCalls) {
			result = result.andThen(() => hookCall());
		}

		return result;
	}

	_runHookParallelWithCtx<K extends keyof Args>(
		hookName: K,
		contextGetter: (plugin: Plugin<Args, Ctx>) => Ctx,
		...additionalArgs: ArgTuple<Args[K]>
	): ResultAsync<void, PluginError[]> {
		const hookCalls = this.#getHookCalls(hookName, contextGetter, ...additionalArgs);
		return ResultAsync.combineWithAllErrors(hookCalls.map((call) => call())).map(() => undefined);
	}
}

export class HookContextProvider<Args, Ctx> {
	readonly #innerDriver: PluginDriver<Args, Ctx>;
	readonly #baseHookContexts = new Map<Plugin<Args, Ctx>, BaseHookContext<Args>>();
	readonly #baseLogger: Logger;
	readonly #abortController: AbortController;

	constructor(innerDriver: PluginDriver<Args, Ctx>, baseLogger: Logger) {
		this.#baseLogger = baseLogger;
		this.#abortController = new AbortController();
		this._initialize(innerDriver.plugins);
		this.#innerDriver = innerDriver;
		this._getPluginContext = this._getPluginContext.bind(this);

		onExit(() => {
			this.#abortController.abort();
		});
	}

	get plugins(): ReadonlyArray<Plugin<Args, Ctx>> {
		return this.#innerDriver.plugins;
	}

	protected _initialize(plugins: ReadonlyArray<Plugin<Args, Ctx>>): void {
		for (const plugin of plugins) {
			this.#baseHookContexts.set(plugin, {
				logger: this.#baseLogger.child({ module: `plugin:${plugin.name}` }),
				abortSignal: this.#abortController.signal,
				emit: this.runHookSequential.bind(this),
			});
		}
	}

	protected _getBaseHookContext(plugin: Plugin<Args, Ctx>): BaseHookContext<Args> {
		const context = this.#baseHookContexts.get(plugin);
		if (!context) {
			throw new Error(`Plugin ${plugin.name} not found in context map`);
		}

		return context;
	}

	protected _getPluginContext(plugin: Plugin<Args, Ctx>): Ctx {
		throw new Error("Not implemented");
	}

	add(plugins: Plugin<Args, Ctx> | Plugin<Args, Ctx>[]): void {
		const pluginArray = Array.isArray(plugins) ? plugins : [plugins];
		this._initialize(pluginArray);
		this.#innerDriver.add(plugins);
	}

	runHookSequential<K extends keyof Args>(
		hookName: K,
		...additionalArgs: ArgTuple<Args[K]>
	): ResultAsync<void, PluginError> {
		return this.#innerDriver._runHookSequentialWithCtx(
			hookName,
			this._getPluginContext,
			...additionalArgs,
		);
	}

	runHookParallel<K extends keyof Args>(
		hookName: K,
		...additionalArgs: ArgTuple<Args[K]>
	): ResultAsync<void, PluginError[]> {
		return this.#innerDriver._runHookParallelWithCtx(
			hookName,
			this._getPluginContext,
			...additionalArgs,
		);
	}
}
