import type {
	BaseCommand,
	CommandDescriptor,
	CommandId,
	CommandParser,
	InstantiatedPlugin,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { err, ok, type Result } from "neverthrow";
import { CommandExecutionError } from "../errors.js";

export type RegisteredCommand = {
	readonly pluginName: string;
	readonly descriptor: CommandDescriptor;
	readonly execute: (
		command: BaseCommand,
	) => ReturnType<NonNullable<InstantiatedPlugin["executeCommand"]>>;
};

function createRegistrationConflictError(commandType: string, message: string) {
	return new CommandExecutionError(message, { commandType });
}

function normalizeParserError(error: unknown, commandType: string): Error {
	return error instanceof Error
		? error
		: new CommandExecutionError(`Invalid command: ${commandType}`, {
				cause: new Error(String(error)),
				commandType,
			});
}

export class CommandRegistry {
	private readonly _commands = new Map<CommandId, RegisteredCommand>();
	private readonly _aliases = new Map<CommandId, CommandId>();

	registerMany(
		pluginName: string,
		descriptors: readonly CommandDescriptor[],
		execute: RegisteredCommand["execute"],
	): Result<void, CommandExecutionError> {
		const nextCommands = new Map(this._commands);
		const nextAliases = new Map(this._aliases);

		for (const descriptor of descriptors) {
			if (nextCommands.has(descriptor.id)) {
				const existing = nextCommands.get(descriptor.id);
				return err(
					createRegistrationConflictError(
						descriptor.id,
						`Command '${descriptor.id}' is already registered by plugin '${existing?.pluginName}'`,
					),
				);
			}

			for (const alias of descriptor.aliases ?? []) {
				if (alias === descriptor.id) {
					return err(
						createRegistrationConflictError(
							alias,
							`Command alias '${alias}' cannot be the same as its canonical command id`,
						),
					);
				}

				if (nextCommands.has(alias) || nextAliases.has(alias)) {
					return err(
						createRegistrationConflictError(
							alias,
							`Command alias '${alias}' conflicts with an existing registered command`,
						),
					);
				}
			}

			nextCommands.set(descriptor.id, {
				pluginName,
				descriptor,
				execute,
			});

			for (const alias of descriptor.aliases ?? []) {
				nextAliases.set(alias, descriptor.id);
			}
		}

		this._commands.clear();
		for (const [id, command] of nextCommands) {
			this._commands.set(id, command);
		}

		this._aliases.clear();
		for (const [alias, canonicalId] of nextAliases) {
			this._aliases.set(alias, canonicalId);
		}

		return ok(undefined);
	}

	resolve(commandType: string): RegisteredCommand | undefined {
		const direct = this._commands.get(commandType as CommandId);
		if (direct) {
			return direct;
		}

		const canonicalId = this._aliases.get(commandType as CommandId);
		if (!canonicalId) {
			return undefined;
		}

		return this._commands.get(canonicalId);
	}

	canonicalizeCommand(command: BaseCommand, descriptor: CommandDescriptor): BaseCommand {
		if (command.type === descriptor.id) {
			return command;
		}

		return {
			...command,
			type: descriptor.id,
		};
	}

	parseCommand<TCommand extends BaseCommand>(
		parser: CommandParser<TCommand> | undefined,
		command: BaseCommand,
	): Result<BaseCommand, CommandExecutionError> {
		if (!parser) {
			return ok(command);
		}

		try {
			const parsed = parser.safeParse(command);
			if (!parsed.success) {
				return err(
					new CommandExecutionError(`Invalid command: ${command.type}`, {
						cause: normalizeParserError(parsed.error, command.type),
						commandType: command.type,
					}),
				);
			}

			return ok(parsed.data);
		} catch (error) {
			return err(
				new CommandExecutionError(`Invalid command: ${command.type}`, {
					cause: normalizeParserError(error, command.type),
					commandType: command.type,
				}),
			);
		}
	}

	getRegisteredCommandIds(): CommandId[] {
		return Array.from(this._commands.keys());
	}
}
