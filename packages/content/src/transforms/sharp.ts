import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import chalk from "chalk";
import PQueue from "p-queue";
import type { Sharp } from "sharp";
import { z } from "zod";
import type { ArtifactResult } from "../cache/artifact-cache.js";
import { safeOutput } from "../cache/fingerprints.js";
import {
	prepareSharpRecipe,
	type SharpRecipe,
	sharpInputDiagnostic,
} from "../cache/sharp-recipe.js";
import { ContentProgressLogger } from "../content-progress-logger.js";
import { type ContentTransformContext, defineContentTransform } from "../content-transform.js";
import { regexToJSONPathQuery } from "../utils/content-transform-utils.js";
import { type DataKeys, dataKeysSchema } from "../utils/data-store.js";
import * as FileUtils from "../utils/file-utils.js";
import { FilesystemIdentity } from "../utils/filesystem-identity.js";
import { parseTransformConfig, queryOrUpdate } from "./content-transform-helpers.js";

const DEFAULT_IMAGE_PATTERN = /\.(jpe?g|png|webp|tiff|gif|svg)$/i;

/** Options for the `sharp` transform. */
export interface SharpOptions {
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys?: DataKeys;
	/** Regex to match urls to download. Defaults to common image file extensions. */
	mediaPattern?: RegExp;
	/** JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`. */
	matchPath?: string;
	/**
	 * Update URLs in the content to point to the transformed images. Defaults to `false`.
	 * Note: if you have multiple transforms targeting the same image, you should set keep the default value of false.
	 */
	updateURLs?: boolean;
	/** The sharp transform to apply to the images. */
	buildTransform: (sharp: Sharp) => Sharp;
	/** Additional cache identity. Does not replace automatic recipe or input fingerprinting. */
	cacheKey?: string;
	/** The number of images to transform concurrently. Defaults to `4`. */
	concurrency?: number;
}

const sharpPluginSchema = configSchema<SharpOptions>()(
	z.object({
		keys: dataKeysSchema.optional(),
		mediaPattern: z
			.instanceof(RegExp)
			.describe("Regex to match urls to download.")
			.default(DEFAULT_IMAGE_PATTERN),
		matchPath: z
			.string()
			.optional()
			.describe(
				"JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`.",
			),
		updateURLs: z
			.boolean()
			.default(false)
			.describe("Update URLs in the content to point to the transformed images"),
		buildTransform: z
			.function({
				input: [z.custom<Sharp>()],
				output: z.custom<Sharp>(),
			})
			.describe("The sharp transform to apply to the images."),
		cacheKey: z.string().optional(),
		concurrency: z.number().default(4).describe("The number of images to transform concurrently."),
	}),
);

function tryImportSharp() {
	try {
		return import("sharp");
	} catch (e) {
		throw new Error('Could not find peer dependency "sharp". Make sure you have installed it.', {
			cause: e,
		});
	}
}

async function transformImage(
	sharpTransform: Sharp,
	sourceImagePath: string,
	outputImagePath: string,
	tempImagePath: string,
) {
	await fs.promises.mkdir(path.dirname(tempImagePath), { recursive: true });
	await fs.promises.mkdir(path.dirname(outputImagePath), { recursive: true });
	await pipeline(
		fs.createReadStream(sourceImagePath),
		sharpTransform,
		fs.createWriteStream(tempImagePath),
	);
	await fs.promises.rename(tempImagePath, outputImagePath);
}

async function requireInput(sourceImagePath: string) {
	const exists = await FileUtils.pathExists(sourceImagePath).match(
		(value) => value,
		(error) => {
			throw new Error(`Error checking if file '${sourceImagePath}' exists`, error);
		},
	);
	if (!exists) {
		throw new Error(
			`Input file '${sourceImagePath}' does not exist or is not readable. Make sure it's been downloaded via the 'mediaDownloader' plugin prior to using the 'sharp' plugin.`,
		);
	}
}

type ImageTask = {
	inputPath: string;
	outputPath: string;
	tempPath: string;
	sourceId: string;
	relativeOutput: string;
};

type PreparedImageTask = ImageTask & { inPlace: boolean };

type PipelineContext = {
	context: ContentTransformContext;
	recipe: SharpRecipe;
	snapshots: ReadonlyMap<string, string>;
	dependencyDiagnostic: string | undefined;
	uncachedClaimKey: string;
	warnUncached: (reason: string) => void;
};

async function runImageTask(
	task: PreparedImageTask,
	config: PipelineContext,
): Promise<ArtifactResult> {
	const { inputPath, outputPath, tempPath, sourceId, relativeOutput, inPlace } = task;
	const { recipe, snapshots } = config;
	const originalInput = snapshots.get(inputPath) ?? inputPath;
	await requireInput(originalInput);
	const diagnostic = recipe.cacheable
		? (config.dependencyDiagnostic ?? (await sharpInputDiagnostic([originalInput])))
		: recipe.reason;
	if (!recipe.cacheable || diagnostic || inPlace) {
		config.warnUncached(diagnostic ?? "input and output paths are identical");
		if (!inPlace) {
			await config.context.cache.claimOutputs({
				sourceId,
				key: JSON.stringify([config.uncachedClaimKey, sourceId, path.resolve(inputPath)]),
				outputs: [relativeOutput],
			});
		}
		await transformImage(recipe.createPipeline(snapshots), originalInput, outputPath, tempPath);
		return { reused: false };
	}
	return config.context.cache.derive({
		sourceId,
		namespace: "sharp",
		version: "1",
		inputs: [originalInput, ...recipe.dependencies.map((input) => snapshots.get(input) ?? input)],
		options: recipe.fingerprint,
		outputs: [relativeOutput],
		generate: () =>
			transformImage(recipe.createPipeline(snapshots), originalInput, outputPath, tempPath),
	});
}

/** Classify physical aliases and freeze overlapping inputs before any cache restores or writes. */
async function prepareImageBatch(
	tasks: readonly ImageTask[],
	dependencies: readonly string[],
	paths: ContentTransformContext["paths"],
): Promise<{ tasks: PreparedImageTask[]; snapshots: ReadonlyMap<string, string> }> {
	if (tasks.length === 0) return { tasks: [], snapshots: new Map() };
	await Promise.all(
		tasks.map(async (task) => {
			const destination = await safeOutput(
				paths.getDownloadPath(task.sourceId),
				task.relativeOutput,
			);
			if (destination !== task.outputPath)
				throw new Error("Sharp output differs from its declared destination");
		}),
	);
	const identity = new FilesystemIdentity();
	const [resolvedTasks, resolvedDependencies] = await Promise.all([
		Promise.all(
			tasks.map(async (task) => {
				const [input, output] = await Promise.all([
					identity.resolve(task.inputPath),
					identity.resolve(task.outputPath),
				]);
				return { task, input, output };
			}),
		),
		Promise.all(
			dependencies.map(async (filename) => ({
				filename,
				identity: await identity.resolve(filename),
			})),
		),
	]);
	const dependencyIdentities = new Set(resolvedDependencies.map((input) => input.identity));
	const preparedTasks = resolvedTasks.map(({ task, input, output }) => ({
		...task,
		inPlace: input === output || dependencyIdentities.has(output),
	}));
	const outputs = new Set(resolvedTasks.map(({ output }) => output));
	const inputs = [
		...resolvedTasks.map(({ task, input }) => ({ filename: task.inputPath, identity: input })),
		...resolvedDependencies,
	];
	const overlapping = [
		...new Set(
			inputs.filter((input) => outputs.has(input.identity)).map((input) => input.filename),
		),
	];
	if (overlapping.length === 0) return { tasks: preparedTasks, snapshots: new Map() };
	const tempRoot = paths.getTempPath();
	await fs.promises.mkdir(tempRoot, { recursive: true });
	const snapshotRoot = await fs.promises.mkdtemp(path.join(tempRoot, "inputs-"));
	const copies = await Promise.allSettled(
		overlapping.map(async (input, index) => {
			const snapshot = path.join(snapshotRoot, `${index}-${path.basename(input)}`);
			await fs.promises.copyFile(input, snapshot);
			return [input, snapshot] as const;
		}),
	);
	const snapshots = new Map<string, string>();
	for (const copy of copies) {
		if (copy.status === "rejected") throw copy.reason;
		snapshots.set(...copy.value);
	}
	return { tasks: preparedTasks, snapshots };
}

export default function sharp(options: SharpOptions) {
	const resolvedConfig = parseTransformConfig("sharp", sharpPluginSchema, options);

	return defineContentTransform({
		name: "sharp",
		async apply(ctx) {
			const { default: Sharp } = await tryImportSharp();

			const queryJsonPath =
				resolvedConfig.matchPath ?? regexToJSONPathQuery(resolvedConfig.mediaPattern);

			const transform = resolvedConfig.buildTransform(Sharp());

			// make sure we don't transform the same image multiple times
			const sourceUrls = new Set<string>();

			const filteredDocuments = ctx.data.filter(options.keys);

			if (filteredDocuments.isErr()) {
				throw filteredDocuments.error;
			}

			const mediaTransformTasks: ImageTask[] = [];

			for (const source of filteredDocuments.value) {
				const queryResult = await queryOrUpdate({
					documents: source.documents,
					queryJsonPath,
					update: resolvedConfig.updateURLs,
					callback: async (val: unknown) => {
						if (typeof val !== "string") {
							throw new Error(`Expected value to be a string, but got '${typeof val}'.`);
						}

						const newLocalPath = getOutputFilename(val, transform);

						const fullInputPath = path.resolve(ctx.paths.getDownloadPath(source.namespaceId), val);
						if (!sourceUrls.has(fullInputPath)) {
							sourceUrls.add(fullInputPath);
							mediaTransformTasks.push({
								inputPath: fullInputPath,
								outputPath: path.resolve(
									ctx.paths.getDownloadPath(source.namespaceId),
									newLocalPath,
								),
								tempPath: path.resolve(ctx.paths.getTempPath(source.namespaceId), newLocalPath),
								sourceId: source.namespaceId,
								relativeOutput: newLocalPath,
							});
						}

						return newLocalPath;
					},
				});
				if (queryResult.isErr()) throw queryResult.error;
			}

			ctx.logger.info(`Transforming ${mediaTransformTasks.length} images...`);

			const queue = new PQueue({ concurrency: resolvedConfig.concurrency });

			const recipe = prepareSharpRecipe(
				transform,
				Sharp.versions,
				() => Sharp(),
				resolvedConfig.cacheKey,
			);
			const { tasks, snapshots } = await prepareImageBatch(
				mediaTransformTasks,
				recipe.dependencies,
				ctx.paths,
			);
			const dependencyDiagnostic =
				recipe.cacheable && mediaTransformTasks.length > 0
					? await sharpInputDiagnostic(
							recipe.loaderInputs.map((input) => snapshots.get(input) ?? input),
						)
					: undefined;
			const progressLogger = new ContentProgressLogger({
				eventBus: ctx.eventBus,
				total: mediaTransformTasks.length,
				label: "Transforming Images",
				freshLabel: "Transformed",
			});

			const diagnostics = new Set<string>();
			const warnUncached = (reason: string) => {
				if (diagnostics.has(reason)) return;
				diagnostics.add(reason);
				ctx.logger.warn(`Sharp artifact cache bypassed: ${reason}`);
			};

			const pipelineContext: PipelineContext = {
				context: ctx,
				recipe,
				snapshots,
				dependencyDiagnostic,
				uncachedClaimKey: `sharp:uncached:${randomUUID()}`,
				warnUncached,
			};
			try {
				await queue.addAll(
					tasks.map((task) => async () => {
						progressLogger.complete(await runImageTask(task, pipelineContext));
					}),
				);
			} finally {
				await queue.onIdle();
				progressLogger.close();
			}

			ctx.logger.info(
				`Of the ${chalk.cyan(mediaTransformTasks.length)} transform images files, ${chalk.green(
					progressLogger.fresh,
				)} were transformed and ${chalk.yellow(progressLogger.cached)} were pulled from cache`,
			);

			await FileUtils.remove(ctx.paths.getTempPath()).match(
				() => {},
				(err) => {
					throw new Error("Failed to cleanup after transform", { cause: err });
				},
			);
		},
	});
}

function getOutputFilename(inputPath: string, sharpTransform: Sharp) {
	const { dir, name, ext } = path.parse(inputPath);

	// 'options' is a private property, so we need to use Object.getOwnPropertyDescriptor
	const options = Object.getOwnPropertyDescriptor(sharpTransform, "options")?.value ?? {};

	const outputFormat = options?.formatOut ?? "input";

	const newExt = outputFormat === "input" ? ext : `.${outputFormat}`;

	let suffix = "";

	if (options?.width !== -1 && options?.height !== -1) {
		suffix += `@${options.width}x${options.height}`;

		if (options?.canvas) {
			suffix += `-${options.canvas}`;
		}
	}

	if (options?.blurSigma) {
		suffix += `@blur_${options.blurSigma}`;
	}

	if (options?.angle) {
		suffix += `@rotate_${options.angle}deg`;
	}

	if (options?.flip) {
		suffix += "@flipped";
	}

	if (options?.flop) {
		suffix += "@flopped";
	}

	if (options?.greyscale) {
		suffix += "@greyscale";
	}

	if (options?.brightness !== 1) {
		suffix += `@brightness_${options.brightness}`;
	}

	if (options?.gamma !== 0) {
		suffix += `@gamma_${options.gamma}`;
	}

	if (options?.hue !== 0) {
		suffix += `@hue_${options.hue}`;
	}

	if (options?.saturation !== 1) {
		suffix += `@saturation_${options.saturation}`;
	}

	if (options?.lightness !== 0) {
		suffix += `@threshold_${options.threshold}`;
	}

	if (options?.normalise) {
		suffix += "@normalized";
	}

	if (options?.negate) {
		suffix += "@negated";
	}

	if (suffix === "") {
		suffix = "@sharp"; // default suffix
	}

	return path.join(dir, `${name}${suffix}${newExt}`);
}
