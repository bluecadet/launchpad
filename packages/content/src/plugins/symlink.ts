import { z } from "zod";
import { defineContentPlugin } from "../content-plugin-driver.js";
import { parsePluginConfig } from "./contentPluginHelpers.js";
import fs from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../utils/file-utils.js";
import chalk from "chalk";

const symlinkSchema = z.object({
	/** Symlink source file/directory */
	source: z.string().describe("Symlink source file/directory"),
	/** Symlink target directory */
	target: z.string().describe("Symlink target file/directory"),
	/** Condition to check before creating symlink */
	condition: z
		.union([
			z.boolean(),
			z
				.function()
				.args()
				.returns(z.union([z.promise(z.boolean()), z.boolean()])),
		])
		.optional()
		.describe("Condition to check before creating symlink"),
});

export default function symlink(options: z.input<typeof symlinkSchema>) {
	const { source, target, condition } = parsePluginConfig("symlink", symlinkSchema, options);

	return defineContentPlugin({
		name: "symlink",
		hooks: {
			async onContentFetchDone(ctx) {
				if (typeof condition === "function") {
					const conditionResult = await condition();
					if (!conditionResult) return;
				} else if (condition === false) {
					return;
				}

				const resolvedSrc = path.resolve(source);
				const resolvedTarget = path.resolve(target);

				// ensure source exists
				const sourceExists = await pathExists(resolvedSrc);
				if (!sourceExists) {
					throw new Error(`Source directory ${chalk.gray(resolvedSrc)} does not exist.`);
				}

				const targetStats = await fs.stat(resolvedTarget).catch(() => null);

				if (targetStats) {
					if (targetStats.isSymbolicLink()) {
						ctx.logger.info(
							`target symlink ${chalk.gray(resolvedTarget)} already exists, skipping`,
						);
						return;
					}
					ctx.logger.warn(
						`target path ${chalk.gray(resolvedTarget)} exists and is not a symlink. Removing it before creating symlink.`,
					);
					await fs.rm(resolvedTarget, { recursive: true, force: true });
				}

				ctx.logger.info(
					`Creating symlink from ${chalk.gray(resolvedSrc)} to ${chalk.gray(resolvedTarget)}`,
				);

				try {
					await fs.symlink(resolvedSrc, resolvedTarget);
				} catch (error) {
					throw new Error(`Failed to create symlink ${resolvedSrc} -> ${resolvedTarget}`, {
						cause: error,
					});
				}
			},
		},
	});
}
