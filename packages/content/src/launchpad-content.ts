import { SingleCommandGuard } from "@bluecadet/launchpad-utils/command-guard";
import { acquireNativeFileLease } from "@bluecadet/launchpad-utils/native-file-lease";
import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { writeAckLease } from "./acks.js";
import { clearContent } from "./clearing/content-clear.js";
import type { ContentActionContext } from "./content-action-context.js";
import {
	type ContentCommand,
	contentCommandSchema,
	type ManifestReadCommandResult,
} from "./content-commands.js";
import { type ContentConfig, parseContentConfig } from "./content-config.js";
import { buildVersionPromotedPayload } from "./content-events.js";
import { projectContentMetrics } from "./content-metrics.js";
import { type ContentState, ContentStateManager } from "./content-state.js";
import { buildContentSection } from "./content-summarize.js";
import { ContentError } from "./content-transform.js";
import { fetchContent } from "./fetching/fetch-run.js";
import { readManifest } from "./manifest.js";
import type { ContentSource } from "./source.js";
import {
	createPathsHelper,
	getProjectCachePaths,
	isSafeSourceId,
	validateContentDirectories,
} from "./utils/paths-helper.js";

function withProjectLease(
	ctx: ContentActionContext,
	operation: () => ResultAsync<void, Error>,
): ResultAsync<void, Error> {
	const acquisition = acquireNativeFileLease(getProjectCachePaths(ctx.cwd).lock, {
		unavailable: "Native content writer lease unavailable",
		acquisitionFailed: "Failed to acquire project content writer lease",
		alreadyOwned: "Another content writer owns this project",
	});
	if (acquisition.isErr()) return errAsync(acquisition.error);
	return ResultAsync.fromPromise(
		(async () => {
			try {
				return await operation();
			} finally {
				const result = acquisition.value.release();
				if (result?.isErr())
					ctx.logger.warn("Failed to release content writer lease", result.error);
			}
		})(),
		(error) => new ContentError("Content command failed", { cause: error }),
	).andThen((result) => result);
}

/** See `writeAckLease` for the ack lease contract. Requires `versioning` to be enabled. */
function ack(
	consumerId: string,
	versionId: string,
	ctx: ContentActionContext,
): ResultAsync<void, Error> {
	if (!ctx.resolvedConfig.versioning) {
		return errAsync(new ContentError("content.ack requires versioning to be enabled"));
	}

	const paths = createPathsHelper(ctx.resolvedConfig, ctx.cwd);
	return writeAckLease(paths.getPublishedDownloadPath(), consumerId, versionId).mapErr(
		(error) => new ContentError(error.message, { cause: error }),
	);
}

/** Reads the active version manifest from the published download path as JSON-safe data. */
function readActiveManifest(
	ctx: ContentActionContext,
): ResultAsync<ManifestReadCommandResult, Error> {
	const paths = createPathsHelper(ctx.resolvedConfig, ctx.cwd);
	return ResultAsync.fromSafePromise(readManifest(paths.getPublishedDownloadPath())).map(
		(result): ManifestReadCommandResult =>
			result.status === "invalid" ? { status: "invalid", message: result.error.message } : result,
	);
}

/**
 * Emits `content:version:promoted` once at startup when a version is already active on disk.
 *
 * Promotion only emits the event when a fetch actually promotes, so after a process restart
 * nothing on the bus says which version is live until the next fetch — and a display app
 * restarting mid-day is the common case. Announcing the on-disk active version at startup gives
 * subscribers (and transports that replay the last frame per event) the same payload they would
 * have seen had they been connected during the original promote.
 *
 * Runs in `ready()`, not `setup()`: setup runs while later-registered plugins (transports, in
 * particular) have not subscribed yet, so an announcement made there would be missed by anything
 * registered after content.
 *
 * Best-effort: only meaningful under versioning, and a missing or unreadable manifest is not a
 * startup failure — the manifest poll remains the authoritative contract.
 */
function announceActiveVersion(ctx: ContentActionContext): ResultAsync<void, never> {
	if (!ctx.resolvedConfig.versioning) {
		return okAsync(undefined);
	}

	return readActiveManifest(ctx)
		.map((result) => {
			if (result.status === "invalid") {
				ctx.logger.warn(`Skipping active version announcement: ${result.message}`);
				return;
			}
			if (result.status === "missing") {
				return;
			}
			ctx.eventBus.emit("content:version:promoted", buildVersionPromotedPayload(result.manifest));
		})
		.orElse(() => okAsync(undefined));
}

/**
 * Creates a LaunchpadContent plugin factory.
 * Use this in your launchpad config's plugins array.
 */
export function content(config: ContentConfig) {
	const configuredSourceIds = new Set<string>();

	return definePlugin({
		name: "content",
		manifest: {
			commands: [
				{ id: "content.fetch", parser: contentCommandSchema },
				{ id: "content.clear", parser: contentCommandSchema },
				{ id: "content.ack", parser: contentCommandSchema },
				{ id: "content.manifest.read", parser: contentCommandSchema },
			],
			cli: [
				{
					name: "content",
					description: "Content commands",
					subcommands: [
						{
							name: "fetch",
							description: "Fetch all content sources",
							commands: [{ type: "content.fetch" }],
							mode: "task",
						},
					],
				},
			],
		},
		summarize(state: LaunchpadState): Section | null {
			const contentState = state.plugins.content;
			if (!contentState) return null;
			return buildContentSection(contentState);
		},
		observe(state: LaunchpadState) {
			return projectContentMetrics(state.plugins.content, configuredSourceIds);
		},
		setup(ctx: PluginContext<ContentState>) {
			return parseContentConfig(config)
				.andThen((resolvedConfig) =>
					ResultAsync.fromPromise(
						validateContentDirectories(resolvedConfig, ctx.cwd),
						(error) => new ContentError("Unsafe content directory configuration", { cause: error }),
					).map(() => resolvedConfig),
				)
				.andTee((resolvedConfig) => {
					if (resolvedConfig.sources.length === 0) {
						ctx.logger.warn("No sources configured");
					}
				})
				.andThen((resolvedConfig) => {
					// initialize persistent services (services that live for the lifetime of the plugin, not per-command)

					const stateManager = new ContentStateManager(ctx.updateState);
					stateManager.setVersioning(
						resolvedConfig.versioning
							? { keepVersions: resolvedConfig.versioning.keepVersions }
							: false,
					);
					const sourceRegistry = new Map<string, ContentSource>();

					// Check for duplicates
					for (const source of resolvedConfig.sources) {
						if (!isSafeSourceId(source.id)) {
							return errAsync(new ContentError(`Invalid source directory name: ${source.id}`));
						}
						if (sourceRegistry.has(source.id)) {
							return errAsync(new ContentError(`Duplicate source ID detected: ${source.id}`));
						}
						sourceRegistry.set(source.id, source);
					}

					configuredSourceIds.clear();
					for (const sourceId of sourceRegistry.keys()) configuredSourceIds.add(sourceId);

					const sourceIds = resolvedConfig.sources.map((s) => s.id);
					stateManager.initializeSources(sourceIds);
					if (sourceIds.length > 0) {
						ctx.logger.info(`Initialized ${sourceIds.length} source(s)`);
					}

					const actionContext = {
						...ctx,
						stateManager,
						sourceRegistry,
						resolvedConfig,
					};

					const commandGuard = new SingleCommandGuard();

					const instance = {
						ready(): ResultAsync<void, Error> {
							return announceActiveVersion(actionContext);
						},
						executeCommand(command: ContentCommand): ResultAsync<unknown, Error> {
							const parsed = contentCommandSchema.safeParse(command);
							if (!parsed.success) {
								return errAsync(new ContentError(`Invalid command: ${parsed.error.message}`));
							}

							const validCommand = parsed.data;

							switch (validCommand.type) {
								case "content.fetch": {
									return commandGuard.run(() =>
										withProjectLease(actionContext, () =>
											fetchContent(validCommand.sources ?? null, actionContext),
										),
									);
								}
								case "content.clear": {
									return commandGuard.run(() =>
										withProjectLease(actionContext, () =>
											clearContent(
												validCommand.sources ?? null,
												{
													temp: validCommand.temp,
													backups: validCommand.backups,
													downloads: validCommand.downloads,
													cache: validCommand.cache,
												},
												actionContext,
											),
										),
									);
								}
								case "content.ack": {
									return ack(validCommand.consumerId, validCommand.versionId, actionContext);
								}
								case "content.manifest.read": {
									return readActiveManifest(actionContext);
								}
								case "content.backup":
								case "content.restore": {
									return errAsync(
										new ContentError(`Command '${validCommand.type}' is not yet implemented`),
									);
								}
								default: {
									validCommand satisfies never;
									return errAsync(new ContentError("Unreachable: unknown command type"));
								}
							}
						},
					};

					return okAsync(instance);
				});
		},
	});
}
