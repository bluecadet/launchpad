import type { ResolvedControllerConfig } from "@bluecadet/launchpad-controller/config";
import type {
	BaseCommand,
	CliDeclaration,
	CliGroupCommand,
	CliLeafCommand,
	CliPositional,
	PluginConfig,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { okAsync } from "neverthrow";
import type { Argv } from "yargs";
import { cliLogger } from "./cli-logger.js";
import { withDaemonOrController } from "./controller-execution.js";

const RESERVED_COMMAND_NAMES = new Set(["start", "stop", "status", "help", "version"]);

export type PluginCliEntry = {
	pluginConfig: PluginConfig;
	declaration: CliDeclaration;
};

function isLeafCommand(decl: CliDeclaration): decl is CliLeafCommand {
	return "commands" in decl;
}

function buildPositionalToken(pos: CliPositional): string {
	const variadicSuffix = pos.variadic ? ".." : "";
	const inner = `${pos.name}${variadicSuffix}`;
	return pos.required ? `<${inner}>` : `[${inner}]`;
}

function applyLeafOptions(yargsInstance: Argv, leaf: CliLeafCommand): Argv {
	let y = yargsInstance;

	if (leaf.flags) {
		for (const [flagName, flag] of Object.entries(leaf.flags)) {
			y = y.option(flagName, {
				type: flag.type,
				alias: flag.alias,
				describe: flag.description,
				default: flag.default,
				demandOption: flag.required,
				array: flag.array,
			});
		}
	}

	if (leaf.positionals) {
		for (const pos of leaf.positionals) {
			y = y.positional(pos.name, {
				type: pos.type,
				describe: pos.description,
				demandOption: pos.required,
				array: pos.variadic,
			});
		}
	}

	return y;
}

function buildLeafCommandString(leaf: CliLeafCommand): string {
	if (!leaf.positionals || leaf.positionals.length === 0) {
		return leaf.name;
	}
	const tokens = leaf.positionals.map(buildPositionalToken);
	return `${leaf.name} ${tokens.join(" ")}`;
}

function collectArgValues(
	args: Record<string, unknown>,
	leaf: CliLeafCommand,
): Record<string, unknown> {
	const merged: Record<string, unknown> = {};

	if (leaf.flags) {
		for (const flagName of Object.keys(leaf.flags)) {
			if (flagName in args) {
				merged[flagName] = args[flagName];
			}
		}
	}

	if (leaf.positionals) {
		for (const pos of leaf.positionals) {
			if (pos.name in args) {
				merged[pos.name] = args[pos.name];
			}
		}
	}

	return merged;
}

function registerLeaf(
	yargsInstance: Argv,
	pluginConfig: PluginConfig,
	leaf: CliLeafCommand,
	dir: string,
	controllerConfig: ResolvedControllerConfig,
): Argv {
	const commandStr = buildLeafCommandString(leaf);

	return yargsInstance.command(
		commandStr,
		leaf.description ?? "",
		(y) => applyLeafOptions(y, leaf),
		async (args) => {
			const argValues = collectArgValues(args as Record<string, unknown>, leaf);

			const buildCommands = (baseCommands: BaseCommand[]): BaseCommand[] =>
				baseCommands.map((cmd) => ({ ...argValues, ...cmd }));

			const result = await withDaemonOrController(dir, controllerConfig, {
				mode: leaf.mode ?? "task",
				ifDaemon: (client) => {
					return buildCommands(leaf.commands).reduce(
						(acc, cmd) => acc.andThen(() => client.executeCommand(cmd)),
						okAsync<unknown, Error>(undefined),
					);
				},
				otherwise: (controller) => {
					return controller.registerPlugin(pluginConfig).andThen(() => {
						return buildCommands(leaf.commands).reduce(
							(acc, cmd) => acc.andThen(() => controller.executeCommand(cmd)),
							okAsync<unknown, Error>(undefined),
						);
					});
				},
			});

			if (result.isErr()) {
				cliLogger.error(result.error);
				process.exit(1);
			}
		},
	);
}

function registerGroup(
	yargsInstance: Argv,
	pluginConfig: PluginConfig,
	group: CliGroupCommand,
	dir: string,
	controllerConfig: ResolvedControllerConfig,
): Argv {
	return yargsInstance.command(
		`${group.name} <command>`,
		group.description ?? "",
		(y) => {
			let sub = y;
			for (const subDecl of group.subcommands) {
				sub = registerDeclaration(sub, pluginConfig, subDecl, dir, controllerConfig);
			}
			return sub;
		},
		() => {},
	);
}

function registerDeclaration(
	yargsInstance: Argv,
	pluginConfig: PluginConfig,
	decl: CliDeclaration,
	dir: string,
	controllerConfig: ResolvedControllerConfig,
): Argv {
	if (isLeafCommand(decl)) {
		return registerLeaf(yargsInstance, pluginConfig, decl, dir, controllerConfig);
	}
	return registerGroup(yargsInstance, pluginConfig, decl, dir, controllerConfig);
}

function detectConflicts(entries: PluginCliEntry[]): void {
	const seen = new Map<string, string>();
	for (const { pluginConfig, declaration } of entries) {
		const name = declaration.name;
		if (RESERVED_COMMAND_NAMES.has(name)) {
			throw new Error(
				`CLI command conflict: "${name}" is a reserved command name and cannot be declared by plugin "${pluginConfig.name}"`,
			);
		}
		if (seen.has(name)) {
			throw new Error(
				`CLI command conflict: "${name}" is declared by both "${seen.get(name)}" and "${pluginConfig.name}"`,
			);
		}
		seen.set(name, pluginConfig.name);
	}
}

export function registerPluginCliCommands(
	yargsInstance: Argv,
	entries: PluginCliEntry[],
	dir: string,
	controllerConfig: ResolvedControllerConfig,
): Argv {
	detectConflicts(entries);

	let y = yargsInstance;
	for (const { pluginConfig, declaration } of entries) {
		y = registerDeclaration(y, pluginConfig, declaration, dir, controllerConfig);
	}
	return y;
}
