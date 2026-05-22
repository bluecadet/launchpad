vi.mock("../utils/controller-execution.js");
vi.mock("../utils/cli-logger.js", async () => ({
	cliLogger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
		fixed: vi.fn(),
		fromPayload: vi.fn(),
		setLevel: vi.fn(),
	},
}));

import type { LaunchpadController } from "@bluecadet/launchpad-controller";
import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import {
	createMockController,
	createMockIPCClient,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import type { CliDeclaration, PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yargs from "yargs/yargs";

import { withDaemonOrController } from "../utils/controller-execution.js";
import {
	type PluginCliEntry,
	registerPluginCliCommands,
} from "../utils/plugin-cli-registration.js";

const mockControllerConfig = controllerConfigSchema.parse({});

function makePlugin(name: string): PluginConfig {
	return { name, setup: vi.fn().mockReturnValue(okAsync({})) };
}

function makeYargs() {
	return yargs([]).exitProcess(false);
}

describe("registerPluginCliCommands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers a leaf command on the yargs instance", () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "my-cmd",
			description: "does a thing",
			commands: [{ type: "my-plugin.action" }],
		};

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(
			makeYargs(),
			[entry],
			"/project",
			mockControllerConfig,
		) as any;

		const help = y.getInternalMethods().getUsageInstance().getCommands();
		const commandNames = help.map(([name]: [string]) => name);
		expect(commandNames).toContain("my-cmd");
	});

	it("registers a group command with subcommands", () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "group",
			description: "a group",
			subcommands: [
				{
					name: "sub",
					description: "a subcommand",
					commands: [{ type: "my-plugin.sub" }],
				},
			],
		};

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(
			makeYargs(),
			[entry],
			"/project",
			mockControllerConfig,
		) as any;

		const help = y.getInternalMethods().getUsageInstance().getCommands();
		const commandNames = help.map(([name]: [string]) => name);
		expect(commandNames.some((n: string) => n.startsWith("group"))).toBe(true);
	});

	it("throws with both plugin names when two plugins declare the same top-level command", () => {
		const pluginA = makePlugin("plugin-alpha");
		const pluginB = makePlugin("plugin-beta");
		const declaration: CliDeclaration = {
			name: "shared-cmd",
			commands: [{ type: "something.action" }],
		};

		const entries: PluginCliEntry[] = [
			{ pluginConfig: pluginA, declaration },
			{ pluginConfig: pluginB, declaration },
		];

		expect(() =>
			registerPluginCliCommands(makeYargs(), entries, "/project", mockControllerConfig),
		).toThrow(/shared-cmd.*plugin-alpha.*plugin-beta|plugin-alpha.*plugin-beta.*shared-cmd/);
	});

	it("conflict error message contains the conflicting command name and both plugin names", () => {
		const pluginA = makePlugin("alpha");
		const pluginB = makePlugin("beta");
		const declaration: CliDeclaration = {
			name: "conflict",
			commands: [{ type: "x.y" }],
		};

		try {
			registerPluginCliCommands(
				makeYargs(),
				[
					{ pluginConfig: pluginA, declaration },
					{ pluginConfig: pluginB, declaration },
				],
				"/project",
				mockControllerConfig,
			);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			const message = (err as Error).message;
			expect(message).toContain("conflict");
			expect(message).toContain("alpha");
			expect(message).toContain("beta");
		}
	});

	it("with empty entries returns the same yargs instance without error", () => {
		const y = makeYargs();
		const result = registerPluginCliCommands(y, [], "/project", mockControllerConfig);
		expect(result).toBe(y);
	});

	it("dispatches all declared commands in order via daemon when daemon is running", async () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "run-seq",
			commands: [{ type: "my-plugin.first" }, { type: "my-plugin.second" }],
		};

		const mockClient = createMockIPCClient();
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.ifDaemon(mockClient as unknown as IPCClient, 999),
		);

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["run-seq"]);

		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenCalledTimes(2);
		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenNthCalledWith(1, {
			type: "my-plugin.first",
		});
		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenNthCalledWith(2, {
			type: "my-plugin.second",
		});
	});

	it("dispatches via controller (registerPlugin then commands) when no daemon", async () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "local-cmd",
			commands: [{ type: "my-plugin.action" }],
		};

		const mockController = createMockController();
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.otherwise(mockController as unknown as LaunchpadController),
		);

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["local-cmd"]);

		expect(vi.mocked(mockController.registerPlugin)).toHaveBeenCalledWith(pluginConfig);
		expect(vi.mocked(mockController.executeCommand)).toHaveBeenCalledWith({
			type: "my-plugin.action",
		});
	});

	it("merges flag values into each dispatched command payload", async () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "flagged",
			commands: [{ type: "my-plugin.do" }],
			flags: {
				target: { type: "string", description: "target name" },
			},
		};

		const mockClient = createMockIPCClient();
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.ifDaemon(mockClient as unknown as IPCClient, 999),
		);

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["flagged", "--target", "prod"]);

		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenCalledWith({
			type: "my-plugin.do",
			target: "prod",
		});
	});

	it("merges positional values into each dispatched command payload", async () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "with-pos",
			commands: [{ type: "my-plugin.run" }],
			positionals: [{ name: "target", type: "string", required: true }],
		};

		const mockClient = createMockIPCClient();
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.ifDaemon(mockClient as unknown as IPCClient, 999),
		);

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["with-pos", "staging"]);

		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenCalledWith({
			type: "my-plugin.run",
			target: "staging",
		});
	});

	it("array flags pass array value into command payload", async () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "multi",
			commands: [{ type: "my-plugin.batch" }],
			flags: {
				items: { type: "string", array: true, description: "list of items" },
			},
		};

		const mockClient = createMockIPCClient();
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.ifDaemon(mockClient as unknown as IPCClient, 999),
		);

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["multi", "--items", "a", "b", "c"]);

		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenCalledWith({
			type: "my-plugin.batch",
			items: ["a", "b", "c"],
		});
	});

	it("variadic positionals collect multiple values into command payload", async () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "variadic-cmd",
			commands: [{ type: "my-plugin.many" }],
			positionals: [{ name: "files", type: "string", variadic: true }],
		};

		const mockClient = createMockIPCClient();
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.ifDaemon(mockClient as unknown as IPCClient, 999),
		);

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["variadic-cmd", "foo.txt", "bar.txt"]);

		const calls = vi.mocked(mockClient.executeCommand).mock.calls;
		expect(calls.length).toBe(1);
		const payload = calls[0]![0] as Record<string, unknown>;
		expect(payload.type).toBe("my-plugin.many");
		expect(Array.isArray(payload.files)).toBe(true);
	});

	it("when withDaemonOrController returns Err, process.exit(1) is called", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "fail-cmd",
			commands: [{ type: "my-plugin.fail" }],
		};

		vi.mocked(withDaemonOrController).mockReturnValue(errAsync(new Error("dispatch failed")));

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["fail-cmd"]);

		expect(exitSpy).toHaveBeenCalledWith(1);
		exitSpy.mockRestore();
	});

	it.each([
		"start",
		"stop",
		"status",
		"help",
		"version",
	])('throws when a plugin declares reserved command name "%s"', (reservedName) => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: reservedName,
			commands: [{ type: "my-plugin.action" }],
		};

		expect(() =>
			registerPluginCliCommands(
				makeYargs(),
				[{ pluginConfig, declaration }],
				"/project",
				mockControllerConfig,
			),
		).toThrow(new RegExp(`"${reservedName}".*reserved|reserved.*"${reservedName}"`));
	});

	it("base command type field is not overwritten by a flag named 'type'", async () => {
		const pluginConfig = makePlugin("my-plugin");
		const declaration: CliDeclaration = {
			name: "typed-cmd",
			commands: [{ type: "my-plugin.action" }],
			flags: {
				type: { type: "string", description: "a flag that would shadow the command type" },
			},
		};

		const mockClient = createMockIPCClient();
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.ifDaemon(mockClient as unknown as IPCClient, 999),
		);

		const entry: PluginCliEntry = { pluginConfig, declaration };
		const y = registerPluginCliCommands(makeYargs(), [entry], "/project", mockControllerConfig);

		await y.parseAsync(["typed-cmd", "--type", "overridden"]);

		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenCalledWith(
			expect.objectContaining({ type: "my-plugin.action" }),
		);
	});
});
