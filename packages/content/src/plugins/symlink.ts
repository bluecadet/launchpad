import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { z } from "zod";
import { defineContentTransform } from "../content-transform.js";
import { parseTransformConfig } from "./content-transform-helpers.js";

const symlinkSchema = z.object({
	/** Symlink target (source file/directory) */
	target: z.string().describe("Symlink target (source file/directory)"),
	/** Symlink path (destination file/directory) */
	path: z.string().describe("Symlink path (destination file/directory)"),
	/** Condition to check before creating symlink */
	condition: z
		.union([
			z.boolean(),
			z.function({
				output: z.custom<Promise<boolean> | boolean>(),
			}),
		])
		.optional()
		.describe("Condition to check before creating symlink"),
});

export default function symlink(options: z.input<typeof symlinkSchema>) {
	const {
		target,
		path: symlinkPath,
		condition,
	} = parseTransformConfig("symlink", symlinkSchema, options);

	return defineContentTransform({
		name: "symlink",
		async apply(ctx) {
			if (typeof condition === "function") {
				const conditionResult = await condition();
				if (!conditionResult) return;
			} else if (condition === false) {
				return;
			}

			const resolvedTarget = path.resolve(ctx.cwd, target);
			const resolvedPath = path.resolve(ctx.cwd, symlinkPath);

			// ensure target exists
			await fs.access(resolvedTarget).catch((e) => {
				throw new Error(`Target directory ${chalk.gray(resolvedTarget)} does not exist.`, {
					cause: e,
				});
			});

			const pathStats = await fs.lstat(resolvedPath).catch(() => null);

			if (pathStats) {
				if (pathStats.isSymbolicLink()) {
					ctx.logger.info(`symlink path ${chalk.gray(resolvedPath)} already exists, skipping`);
					return;
				}
				ctx.logger.warn(
					`symlink path ${chalk.gray(resolvedPath)} exists and is not a symlink. Removing it before creating symlink.`,
				);
				await fs.rm(resolvedPath, { recursive: true, force: true });
			}

			ctx.logger.info(
				`Creating symlink from ${chalk.gray(resolvedTarget)} to ${chalk.gray(resolvedPath)}`,
			);

			try {
				// create parent directory of path if it doesn't exist
				await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
				await fs.symlink(resolvedTarget, resolvedPath);
			} catch (error) {
				throw new Error(`Failed to create symlink ${resolvedTarget} -> ${resolvedPath}`, {
					cause: error,
				});
			}
		},
	});
}
