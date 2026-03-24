import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import chalk from "chalk";
import PQueue from "p-queue";
import type SharpType from "sharp";
import { z } from "zod";
import { defineContentTransform } from "../content-transform.js";
import { getMatchingDocuments, regexToJSONPathQuery } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import * as FileUtils from "../utils/file-utils.js";
import {
	CacheProgressLogger,
	parseTransformConfig,
	queryOrUpdate,
} from "./content-transform-helpers.js";

const DEFAULT_IMAGE_PATTERN = /\.(jpe?g|png|webp|tiff|gif|svg)$/i;

const sharpPluginSchema = z.object({
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys: dataKeysSchema.optional(),
	/** Regex to match urls to download. */
	mediaPattern: z
		.instanceof(RegExp)
		.describe("Regex to match urls to download.")
		.default(DEFAULT_IMAGE_PATTERN),
	/** JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`. */
	matchPath: z
		.string()
		.optional()
		.describe(
			"JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`.",
		),
	/**
	 * Update URLs in the content to point to the transformed images. Defaults to false.
	 * Note: if you have multiple transforms targeting the same image, you should set keep the default value of false.
	 */
	updateURLs: z
		.boolean()
		.default(false)
		.describe("Update URLs in the content to point to the transformed images"),
	/** The sharp transform to apply to the images. */
	buildTransform: z
		.function(z.tuple([z.custom<SharpType.Sharp>()]))
		.returns(z.custom<SharpType.Sharp>())
		.describe("The sharp transform to apply to the images."),
	/** The number of images to transform concurrently. Defaults to 4. */
	concurrency: z.number().default(4).describe("The number of images to transform concurrently."),
});

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
	sharpTransform: SharpType.Sharp,
	sourceImagePath: string,
	outputImagePath: string,
	backupImagePath: string,
) {
	await FileUtils.ensureDir(path.dirname(outputImagePath)).mapErr((err) => {
		throw new Error(`Error creating directory '${path.dirname(outputImagePath)}'`, err);
	});

	const backupExists = await FileUtils.pathExists(backupImagePath).match(
		(val) => val,
		(err) => {
			throw new Error(`Error checking if file '${backupImagePath}' exists`, err);
		},
	);

	if (backupExists) {
		await FileUtils.copyFile(backupImagePath, outputImagePath).match(
			() => {},
			(err) => {
				throw new Error(`Error copying file '${backupImagePath}' to '${outputImagePath}'`, err);
			},
		);
		return { output: outputImagePath, fromCache: true };
	}

	const result = await FileUtils.pathExists(sourceImagePath).match(
		(val) => val,
		(err) => {
			throw new Error(`Error checking if file '${sourceImagePath}' exists`, err);
		},
	);

	if (!result) {
		throw new Error(
			`Input file '${sourceImagePath}' does not exist or is not readable. Make sure it's been downloaded via the 'mediaDownloader' plugin prior to using the 'sharp' plugin.`,
		);
	}

	await pipeline(
		fs.createReadStream(sourceImagePath),
		sharpTransform.clone(),
		fs.createWriteStream(outputImagePath),
	);

	return { output: outputImagePath, fromCache: false };
}

export default function sharp(options: z.input<typeof sharpPluginSchema>) {
	const resolvedConfig = parseTransformConfig("sharp", sharpPluginSchema, options);

	return defineContentTransform({
		name: "sharp",
		async apply(ctx) {
			const { default: Sharp } = await tryImportSharp();

			const matchingDocuments = getMatchingDocuments(ctx.data, resolvedConfig.keys);

			if (matchingDocuments.isErr()) {
				throw matchingDocuments.error;
			}

			const documents = matchingDocuments.value;

			const queryJsonPath =
				resolvedConfig.matchPath ?? regexToJSONPathQuery(resolvedConfig.mediaPattern);

			const transform = resolvedConfig.buildTransform(Sharp());

			transform.setMaxListeners(0);

			// make sure we don't transform the same image multiple times
			const sourceUrls = new Set<string>();

			const filteredDocuments = ctx.data.filter(options.keys);

			if (filteredDocuments.isErr()) {
				throw filteredDocuments.error;
			}

			const mediaTransformTasks = [] as Array<{
				inputPath: string;
				outputPath: string;
				backupPath: string;
			}>;

			for (const source of filteredDocuments.value) {
				const queryResult = await queryOrUpdate({
					documents,
					queryJsonPath,
					update: resolvedConfig.updateURLs,
					callback: async (val: unknown) => {
						if (typeof val !== "string") {
							throw new Error(`Expected value to be a string, but got '${typeof val}'.`);
						}

						const newLocalPath = getOutputFilename(val, transform);

						if (!sourceUrls.has(val)) {
							sourceUrls.add(val);

							const fullInputPath = path.resolve(
								ctx.paths.getDownloadPath(source.namespaceId),
								val,
							);
							const fullOutputPath = path.resolve(
								ctx.paths.getTempPath(source.namespaceId),
								newLocalPath,
							);
							const fullBackupPath = path.resolve(
								ctx.paths.getBackupPath(source.namespaceId),
								newLocalPath,
							);

							mediaTransformTasks.push({
								inputPath: fullInputPath,
								outputPath: fullOutputPath,
								backupPath: fullBackupPath,
							});
						}

						return newLocalPath;
					},
				});
				if (queryResult.isErr()) throw queryResult.error;
			}

			ctx.logger.info(`Transforming ${mediaTransformTasks.length} images...`);

			const queue = new PQueue({ concurrency: resolvedConfig.concurrency });

			const progressLogger = new SharpProgressLogger(
				ctx.logger,
				ctx.eventBus,
				mediaTransformTasks.length,
			);

			await queue.addAll(
				mediaTransformTasks.map(({ inputPath, outputPath, backupPath }) => async () => {
					const { fromCache } = await transformImage(transform, inputPath, outputPath, backupPath);

					if (fromCache) {
						progressLogger.addCached();
					} else {
						progressLogger.addFresh();
					}
				}),
			);

			progressLogger.close();

			ctx.logger.info(
				`Of the ${chalk.cyan(mediaTransformTasks.length)} transform images files, ${chalk.green(
					progressLogger.fresh,
				)} were transformed and ${chalk.yellow(progressLogger.cached)} were pulled from cache`,
			);

			// cleanup – move transformed images to download path and remove temp path
			await FileUtils.copy(ctx.paths.getTempPath(), ctx.paths.getDownloadPath())
				.andThen(() => FileUtils.remove(ctx.paths.getTempPath()))
				.mapErr((err) => new Error("Failed to cleanup after transform", err));
		},
	});
}

function getOutputFilename(inputPath: string, sharpTransform: SharpType.Sharp) {
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

class SharpProgressLogger extends CacheProgressLogger {
	override getFixedConsoleMessage(): string {
		const prefix = "Transforming Images: ";
		return (
			`${prefix}${super.renderProgressBar(prefix.length)}\n` +
			`Transformed: ${chalk.green(this.fresh)}, Cached: ${chalk.yellow(this.cached)}, Remaining: ${this.total - this.fresh - this.cached} \n`
		);
	}
}
