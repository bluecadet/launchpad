import chalk from "chalk";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import { z } from "zod";
import { PluginNotFoundError } from "./errors.js";
import type { EventBus } from "./event-bus.js";
import type { Logger } from "./logger.js";

export { PluginNotFoundError } from "./errors.js";

export class PluginError extends Error {
	pluginId?: string;
	declare cause: unknown;

	constructor(cause: unknown, { pluginId }: { pluginId?: string } = {}) {
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
	eventBus: EventBus;
	abortSignal: AbortSignal;
	cwd: string;
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

export class PluginDriver<T extends HookSet> {
	#plugins: Plugin<T>[] = [];
	readonly #baseHookContexts = new Map<Plugin<T>, BaseHookContext>();
	readonly #baseLogger: Logger;
	readonly #eventBus: EventBus;
	readonly #abortSignal: AbortSignal;
	readonly #cwd: string;

	get plugins(): ReadonlyArray<Plugin<T>> {
		return this.#plugins;
	}

	constructor(
		{
			logger,
			eventBus,
			cwd,
			abortSignal,
		}: { logger: Logger; eventBus: EventBus; cwd?: string; abortSignal: AbortSignal },
		plugins?: Plugin<T>[],
	) {
		this.#baseLogger = logger;
		this.#eventBus = eventBus;
		this.#abortSignal = abortSignal;
		this.#cwd = cwd || process.cwd();

		if (plugins) {
			this.add(plugins);
		}
	}

	add(plugins: Plugin<T> | Plugin<T>[]): void {
		const pluginArray = Array.isArray(plugins) ? plugins : [plugins];

		for (const plugin of pluginArray) {
			this.#plugins.push(plugin);
			this.#baseHookContexts.set(plugin, {
				logger: this.#baseLogger.child(`plugin:${plugin.name}`),
				abortSignal: this.#abortSignal,
				eventBus: this.#eventBus,
				cwd: this.#cwd,
			});
		}
	}

	#getBaseContext(plugin: Plugin<T>): Result<BaseHookContext, PluginNotFoundError> {
		const ctx = this.#baseHookContexts.get(plugin);
		if (!ctx) return err(new PluginNotFoundError(plugin.name));
		return ok(ctx);
	}

	#getHookCalls<K extends keyof T>(
		hookName: K,
		contextGetter: (
			plugin: Plugin<T>,
		) => Result<Omit<Parameters<T[K]>[0], keyof BaseHookContext>, PluginNotFoundError>,
		additionalArgs: Tail<Parameters<T[K]>>,
	): (() => ResultAsync<void, PluginError>)[] {
		return this.#plugins.map((plugin) => {
			const hook = plugin.hooks[hookName];
			if (hook) {
				return () =>
					this.#getBaseContext(plugin).match(
						(baseCtx) =>
							contextGetter(plugin).match(
								(extraCtx) =>
									ResultAsync.fromPromise(
										(async () => {
											await hook({ ...baseCtx, ...extraCtx }, ...additionalArgs);
										})(),
										(e) => {
											baseCtx.logger.error(chalk.red(`Error in hook ${String(hookName)}`));
											baseCtx.logger.error(chalk.red(e));
											return new PluginError(e, { pluginId: plugin.name });
										},
									),
								(e) => errAsync(new PluginError(e, { pluginId: plugin.name })),
							),
						(e) => errAsync(new PluginError(e, { pluginId: plugin.name })),
					);
			}

			return () => okAsync(undefined);
		});
	}

	_runHookSequentialWithCtx<K extends keyof T>(
		hookName: K,
		contextGetter: (
			plugin: Plugin<T>,
		) => Result<Omit<Parameters<T[K]>[0], keyof BaseHookContext>, PluginNotFoundError>,
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
		contextGetter: (
			plugin: Plugin<T>,
		) => Result<Omit<Parameters<T[K]>[0], keyof BaseHookContext>, PluginNotFoundError>,
		additionalArgs: Tail<Parameters<T[K]>>,
	): ResultAsync<void, PluginError[]> {
		const hookCalls = this.#getHookCalls(hookName, contextGetter, additionalArgs);

		return ResultAsync.combineWithAllErrors(hookCalls.map((call) => call())).map(() => undefined);
	}

	runHookSequential<K extends KeysWithFullContext<T, BaseHookContext>>(
		hookName: K,
		...additionalArgs: Tail<Parameters<T[K]>>
	): ResultAsync<void, PluginError> {
		return this._runHookSequentialWithCtx(
			hookName,
			(_plugin) => ok({} as Omit<Parameters<T[K]>[0], keyof BaseHookContext>),
			additionalArgs,
		);
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

	protected _initialize(_plugins: ReadonlyArray<Plugin<T>>): void {
		// implement in subclass
	}

	protected _getPluginContext(_plugin: Plugin<T>): Result<C, PluginNotFoundError> {
		return err(new PluginNotFoundError("_getPluginContext not implemented"));
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
