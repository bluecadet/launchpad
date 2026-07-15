import { createMockEventBus } from "@bluecadet/launchpad-testing/test-utils.ts";
import type {
	BaseCommand,
	CommandDescriptor,
	InstantiatedPlugin,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../command-dispatcher.js";
import { CommandRegistry } from "../command-registry.js";

function createDispatcher(
	descriptors: Array<{
		pluginName: string;
		descriptor: CommandDescriptor;
		executeCommand?: InstantiatedPlugin["executeCommand"];
	}>,
) {
	const eventBus = createMockEventBus();
	const registry = new CommandRegistry();

	const grouped = new Map<
		string,
		{
			descriptors: CommandDescriptor[];
			executeCommand: NonNullable<InstantiatedPlugin["executeCommand"]>;
		}
	>();

	for (const entry of descriptors) {
		const executeCommand = entry.executeCommand ?? vi.fn().mockReturnValue(okAsync(undefined));
		const group = grouped.get(entry.pluginName);
		if (group) {
			group.descriptors.push(entry.descriptor);
			continue;
		}
		grouped.set(entry.pluginName, {
			descriptors: [entry.descriptor],
			executeCommand,
		});
	}

	for (const [pluginName, group] of grouped) {
		const result = registry.registerMany(pluginName, group.descriptors, (command) =>
			group.executeCommand(command),
		);
		if (result.isErr()) {
			throw result.error;
		}
	}

	return { eventBus, dispatcher: new CommandDispatcher(eventBus, registry) };
}

describe("CommandDispatcher", () => {
	describe("dispatch", () => {
		it("should dispatch command to the registered handler", async () => {
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));
			const { dispatcher } = createDispatcher([
				{ pluginName: "content", descriptor: { id: "content.fetch" }, executeCommand },
			]);

			const command: BaseCommand = { type: "content.fetch" };
			const result = await dispatcher.dispatch(command);

			expect(executeCommand).toHaveBeenCalledWith(command);
			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("success");
		});

		it("should emit command:start event before execution", async () => {
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));
			const { eventBus, dispatcher } = createDispatcher([
				{ pluginName: "content", descriptor: { id: "content.fetch" }, executeCommand },
			]);
			const emitSpy = vi.spyOn(eventBus, "emit");
			const command: BaseCommand = { type: "content.fetch", sources: ["test"] };

			await dispatcher.dispatch(command);

			expect(emitSpy).toHaveBeenCalledWith("command:start", {
				commandType: "content.fetch",
				type: "content.fetch",
				sources: ["test"],
			});
		});

		it("should emit command:success event on successful execution", async () => {
			const executeCommand = vi.fn().mockReturnValue(okAsync({ files: 42 }));
			const { eventBus, dispatcher } = createDispatcher([
				{ pluginName: "content", descriptor: { id: "content.fetch" }, executeCommand },
			]);
			const emitSpy = vi.spyOn(eventBus, "emit");

			await dispatcher.dispatch({ type: "content.fetch" });

			expect(emitSpy).toHaveBeenCalledWith("command:success", {
				commandType: "content.fetch",
				result: { files: 42 },
			});
		});

		it("should emit command:error event on failed execution", async () => {
			const executeCommand = vi.fn().mockReturnValue(errAsync(new Error("Fetch failed")));
			const { eventBus, dispatcher } = createDispatcher([
				{ pluginName: "content", descriptor: { id: "content.fetch" }, executeCommand },
			]);
			const emitSpy = vi.spyOn(eventBus, "emit");

			await dispatcher.dispatch({ type: "content.fetch" });

			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					commandType: "content.fetch",
					error: expect.any(Error),
				}),
			);
		});

		it("should return error when a command is not registered", async () => {
			const { eventBus, dispatcher } = createDispatcher([]);
			const emitSpy = vi.spyOn(eventBus, "emit");

			const result = await dispatcher.dispatch({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("is not registered");
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					commandType: "content.fetch",
					error: expect.any(Error),
				}),
			);
		});

		it("should pass through plugin execution errors", async () => {
			const customError = new Error("Custom plugin error");
			const executeCommand = vi.fn().mockReturnValue(errAsync(customError));
			const { dispatcher } = createDispatcher([
				{ pluginName: "content", descriptor: { id: "content.fetch" }, executeCommand },
			]);

			const result = await dispatcher.dispatch({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			const error = result._unsafeUnwrapErr();
			expect(error.message).toContain("Plugin command execution failed");
			expect(error.cause).toBe(customError);
		});

		it("should contain plugins that throw synchronously instead of returning errAsync", async () => {
			const thrown = new Error("plugin exploded");
			const executeCommand = vi.fn().mockImplementation(() => {
				throw thrown;
			});
			const { eventBus, dispatcher } = createDispatcher([
				{ pluginName: "content", descriptor: { id: "content.fetch" }, executeCommand },
			]);
			const emitSpy = vi.spyOn(eventBus, "emit");

			const result = await dispatcher.dispatch({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().cause).toBe(thrown);
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({ commandType: "content.fetch" }),
			);
		});

		it("should contain plugins whose ResultAsync rejects its underlying promise", async () => {
			const rejection = new Error("underlying promise rejected");
			const executeCommand = vi
				.fn()
				.mockReturnValue(ResultAsync.fromSafePromise(Promise.reject(rejection)));
			const { dispatcher } = createDispatcher([
				{ pluginName: "content", descriptor: { id: "content.fetch" }, executeCommand },
			]);

			const result = await dispatcher.dispatch({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().cause).toBe(rejection);
		});

		it("should resolve command aliases through the explicit registry", async () => {
			const executeCommand = vi.fn().mockReturnValue(okAsync("aliased"));
			const { dispatcher } = createDispatcher([
				{
					pluginName: "content",
					descriptor: { id: "content.fetch", aliases: ["content.sync"] },
					executeCommand,
				},
			]);

			const result = await dispatcher.dispatch({ type: "content.sync" });

			expect(result.isOk()).toBe(true);
			expect(executeCommand).toHaveBeenCalledWith({ type: "content.fetch" });
		});

		it("should canonicalize aliased commands before parser validation", async () => {
			const executeCommand = vi.fn().mockReturnValue(okAsync("aliased"));
			const parser = {
				safeParse(input: unknown) {
					const command = input as BaseCommand;
					if (command.type !== "content.fetch") {
						return { success: false as const, error: new Error("expected canonical type") };
					}
					return { success: true as const, data: command };
				},
			};
			const { dispatcher } = createDispatcher([
				{
					pluginName: "content",
					descriptor: { id: "content.fetch", aliases: ["content.sync"], parser },
					executeCommand,
				},
			]);

			const result = await dispatcher.dispatch({ type: "content.sync" });

			expect(result.isOk()).toBe(true);
			expect(executeCommand).toHaveBeenCalledWith({ type: "content.fetch" });
		});

		it("should surface parser failures", async () => {
			const executeCommand = vi.fn().mockReturnValue(okAsync("validated"));
			const { eventBus, dispatcher } = createDispatcher([
				{
					pluginName: "content",
					descriptor: {
						id: "content.fetch",
						parser: {
							safeParse() {
								return { success: false as const, error: new Error("bad command") };
							},
						},
					},
					executeCommand,
				},
			]);
			const emitSpy = vi.spyOn(eventBus, "emit");

			const result = await dispatcher.dispatch({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			expect(executeCommand).not.toHaveBeenCalled();
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({ commandType: "content.fetch", error: expect.any(Error) }),
			);
		});

		it("should surface thrown parser errors", async () => {
			const executeCommand = vi.fn().mockReturnValue(okAsync("validated"));
			const { dispatcher } = createDispatcher([
				{
					pluginName: "content",
					descriptor: {
						id: "content.fetch",
						parser: {
							safeParse() {
								throw new Error("parser blew up");
							},
						},
					},
					executeCommand,
				},
			]);

			const result = await dispatcher.dispatch({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().cause).toBeInstanceOf(Error);
			expect(executeCommand).not.toHaveBeenCalled();
		});
	});
});
