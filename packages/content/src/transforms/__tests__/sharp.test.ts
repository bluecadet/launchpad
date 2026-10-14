import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import SharpFactory, { type Sharp } from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ArtifactCache, createArtifactCache } from "../../cache/artifact-cache.js";
import * as sharpRecipes from "../../cache/sharp-recipe.js";
import type { ContentTransformContext } from "../../content-transform.js";
import type { DataStore } from "../../utils/data-store.js";
import sharp from "../sharp.js";
import { createTestPluginContext as createBaseContext } from "./plugins.test-utils.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

const testImage = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

describe("sharp", () => {
	let databaseDirectory: string;
	const instances: ArtifactCache[] = [];
	const dataStores: DataStore[] = [];
	beforeEach(() => {
		databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "launchpad-sharp-cache-"));
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		for (const instance of instances.splice(0)) await instance.close();
		for (const data of dataStores.splice(0)) await data.close();
		fs.rmSync(databaseDirectory, { recursive: true, force: true });
	});

	function filePath(relative: string) {
		return path.join(databaseDirectory, relative);
	}
	const files = {
		mkdirSync: (file: string, options: fs.MakeDirectoryOptions) =>
			fs.mkdirSync(filePath(file), options),
		writeFileSync: (file: string, bytes: string | Buffer) =>
			fs.writeFileSync(filePath(file), bytes),
		readFileSync: (file: string) => fs.readFileSync(filePath(file)),
		existsSync: (file: string) => fs.existsSync(filePath(file)),
		unlinkSync: (file: string) => fs.unlinkSync(filePath(file)),
	};

	async function createTestPluginContext(): Promise<
		ContentTransformContext & { cache: ArtifactCache }
	> {
		const base = await createBaseContext({
			dataDirectory: filePath(`data-${instances.length}`),
		});
		const ctx = {
			...base,
			paths: {
				...base.paths,
				getDownloadPath: (sourceId?: string) => filePath(path.join("download", sourceId ?? "")),
				getTempPath: (sourceId?: string) => filePath(path.join("temp", sourceId ?? "")),
			},
		};
		const cache = await createArtifactCache({
			databasePath: path.join(databaseDirectory, "cache.sqlite"),
			previousRoot: (sourceId) => filePath(path.join("published", sourceId)),
			stagedRoot: (sourceId) => ctx.paths.getDownloadPath(sourceId),
		});
		instances.push(cache);
		dataStores.push(ctx.data);
		return { ...ctx, cache };
	}

	async function imageContext(sources = ["test"]) {
		const ctx = await createTestPluginContext();
		for (const source of sources) {
			files.mkdirSync(`/download/${source}`, { recursive: true });
			files.writeFileSync(`/download/${source}/image.jpg`, testImage);
			const namespace = (await ctx.data.createNamespace(source))._unsafeUnwrap();
			await namespace.insert("doc1", Promise.resolve({ images: ["image.jpg", "image.jpg"] }));
		}
		return ctx;
	}

	async function localImagesContext(images: Record<string, Buffer>) {
		const ctx = await createTestPluginContext();
		files.mkdirSync("/download/test", { recursive: true });
		for (const [name, bytes] of Object.entries(images)) {
			files.writeFileSync(`/download/test/${name}`, bytes);
		}
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ images: Object.keys(images) }));
		return ctx;
	}

	function solidImage(background: string) {
		return SharpFactory({ create: { width: 1, height: 1, channels: 3, background } })
			.png()
			.toBuffer();
	}

	async function publish(
		ctx: ContentTransformContext & { cache: ArtifactCache },
		sources = ["test"],
	) {
		await ctx.cache.beginPublication(sources);
		for (const source of sources) {
			fs.cpSync(filePath(`/download/${source}`), filePath(`/published/${source}`), {
				recursive: true,
			});
		}
		await ctx.cache.commitPublication((sourceId) => filePath(`/published/${sourceId}`));
	}

	describe("plugin integration", () => {
		it("should transform images and maintain cache", async () => {
			// Set up test files
			files.mkdirSync("/download/test", { recursive: true });
			files.writeFileSync("/download/test/image.jpg", testImage);

			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: ["image.jpg"],
				}),
			);

			const transform = sharp({
				buildTransform: (t: Sharp) => t.resize(100, 100),
				updateURLs: true,
			});

			// First run - should transform image
			await transform.apply(ctx);

			// Check transformed file exists
			const transformedPath = "/download/test/image@100x100-crop.jpg";
			expect(files.existsSync(transformedPath)).toBe(true);

			// Check data is updated
			const updatedDoc = await namespace.document("doc1")._unsafeUnwrap()._read();
			expect(updatedDoc).toEqual({ images: ["image@100x100-crop.jpg"] });
		});

		it("should handle multiple transforms on same image", async () => {
			files.mkdirSync("/download/test", { recursive: true });
			files.writeFileSync("/download/test/image.jpg", testImage);

			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					image: "image.jpg",
				}),
			);

			// First transform - resize
			await sharp({
				buildTransform: (t) => t.resize(100, 100),
				updateURLs: false,
			}).apply(ctx);

			// Second transform - grayscale
			await sharp({
				buildTransform: (t) => t.grayscale(),
				updateURLs: false,
			}).apply(ctx);

			expect(files.existsSync("/download/test/image@100x100-crop.jpg")).toBe(true);
			expect(files.existsSync("/download/test/image@greyscale.jpg")).toBe(true);
		});

		it("should error if source image doesn't exist", async () => {
			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					image: "nonexistent.jpg",
				}),
			);

			const transform = sharp({
				buildTransform: (t) => t.resize(100, 100),
			});

			await expect(transform.apply(ctx)).rejects.toThrow(
				`Input file '${filePath("/download/test/nonexistent.jpg")}' does not exist`,
			);
		});

		it("should respect custom mediaPattern", async () => {
			files.mkdirSync("/download/test", { recursive: true });
			files.writeFileSync("/download/test/image.png", testImage);
			files.writeFileSync("/download/test/image.jpg", testImage);

			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: ["image.png", "image.jpg"],
				}),
			);

			const transform = sharp({
				mediaPattern: /\.png$/,
				buildTransform: (t) => t.resize(100, 100),
			});

			await transform.apply(ctx);

			expect(files.existsSync("/download/test/image@100x100-crop.png")).toBe(true);
			expect(files.existsSync("/download/test/image@100x100-crop.jpg")).toBe(false);
		});

		it("reuses stable recipes from published output and ignores untracked backups", async () => {
			const options = { buildTransform: (pipeline: Sharp) => pipeline.jpeg({ quality: 85 }) };
			const first = await imageContext();
			files.mkdirSync("/backup/test", { recursive: true });
			files.writeFileSync("/backup/test/image@sharp.jpeg", "untrusted backup");
			const firstDerive = vi.spyOn(first.cache, "derive");
			await sharp(options).apply(first);
			expect(await firstDerive.mock.results[0]?.value).toEqual({ reused: false });
			await publish(first);
			const generated = files.readFileSync("/published/test/image@sharp.jpeg");
			const next = await imageContext();
			files.unlinkSync("/download/test/image@sharp.jpeg");
			const derive = vi.spyOn(next.cache, "derive");
			await sharp(options).apply(next);
			expect(await derive.mock.results[0]?.value).toEqual({ reused: true });
			expect(files.readFileSync("/download/test/image@sharp.jpeg")).toEqual(generated);
		});

		it("analyzes a shared buffered recipe once per apply and constructs pipelines only on misses", async () => {
			const originalPrepare = sharpRecipes.prepareSharpRecipe;
			const constructed = vi.fn();
			const analysis = vi
				.spyOn(sharpRecipes, "prepareSharpRecipe")
				.mockImplementation((...args) => {
					const recipe = originalPrepare(...args);
					return {
						...recipe,
						createPipeline(snapshots) {
							constructed();
							return recipe.createPipeline(snapshots);
						},
					};
				});
			const images = {
				"first.png": await solidImage("red"),
				"second.png": await solidImage("green"),
			};
			const options = {
				buildTransform: (pipeline: Sharp) => pipeline.composite([{ input: testImage }]).png(),
			};
			const first = await localImagesContext(images);
			await sharp(options).apply(first);
			expect(analysis).toHaveBeenCalledTimes(1);
			expect(constructed).toHaveBeenCalledTimes(2);
			await publish(first);
			analysis.mockClear();
			constructed.mockClear();
			const next = await localImagesContext(images);
			const derive = vi.spyOn(next.cache, "derive");
			await sharp(options).apply(next);
			expect(analysis).toHaveBeenCalledTimes(1);
			expect(constructed).not.toHaveBeenCalled();
			for (const result of derive.mock.results)
				expect(await result.value).toEqual({ reused: true });
		});

		it.each([1, 2])(
			"preserves original batch inputs when outputs overlap another input (concurrency %s)",
			async (concurrency) => {
				const images = {
					"image.png": await solidImage("red"),
					"image@sharp.png": await solidImage("blue"),
				};
				const ctx = await localImagesContext(images);
				await sharp({ buildTransform: (pipeline) => pipeline.png(), concurrency }).apply(ctx);
				expect(files.readFileSync("/download/test/image@sharp@sharp.png")).toEqual(
					await SharpFactory(images["image@sharp.png"]).png().toBuffer(),
				);
				await publish(ctx);
				const next = await localImagesContext(images);
				const derive = vi.spyOn(next.cache, "derive");
				await sharp({ buildTransform: (pipeline) => pipeline.png(), concurrency }).apply(next);
				expect(derive).toHaveBeenCalledTimes(2);
				for (const result of derive.mock.results)
					expect(await result.value).toEqual({ reused: true });
				expect(files.readFileSync("/download/test/image@sharp@sharp.png")).toEqual(
					await SharpFactory(images["image@sharp.png"]).png().toBuffer(),
				);
			},
		);

		it("freezes an overlapping input before another task restores a cache hit", async () => {
			const images = {
				"image.png": await solidImage("red"),
				"image@sharp.png": await solidImage("blue"),
			};
			const options = { buildTransform: (pipeline: Sharp) => pipeline.png(), concurrency: 1 };
			const first = await localImagesContext(images);
			await sharp(options).apply(first);
			await publish(first);
			const green = await solidImage("green");
			const next = await localImagesContext({ ...images, "image@sharp.png": green });
			const derive = vi.spyOn(next.cache, "derive");
			await sharp(options).apply(next);
			expect(await derive.mock.results[0]?.value).toEqual({ reused: true });
			expect(await derive.mock.results[1]?.value).toEqual({ reused: false });
			expect(files.readFileSync("/download/test/image@sharp@sharp.png")).toEqual(
				await SharpFactory(green).png().toBuffer(),
			);
		});

		it.each([
			[1, false],
			[2, false],
			[1, true],
			[2, true],
		])(
			"preserves overwritten file dependencies (concurrency %s, uncached %s)",
			async (concurrency, uncached) => {
				const images = {
					"image.png": await solidImage("red"),
					"other.png": await solidImage("green"),
				};
				const overlay = await solidImage("blue");
				const ctx = await localImagesContext(images);
				const overlayPath = filePath("/download/test/image@sharp.png");
				files.writeFileSync("/download/test/image@sharp.png", overlay);
				await sharp({
					concurrency,
					buildTransform: (pipeline) => {
						const transform = pipeline
							.composite([{ input: overlayPath, blend: "difference" }])
							.png();
						if (uncached) {
							const options: Record<string, unknown> = Object.getOwnPropertyDescriptor(
								transform,
								"options",
							)?.value;
							options.futureCallback = () => "unsupported";
						}
						return transform;
					},
				}).apply(ctx);
				expect(files.readFileSync("/download/test/other@sharp.png")).toEqual(
					await SharpFactory(images["other.png"])
						.composite([{ input: overlay, blend: "difference" }])
						.png()
						.toBuffer(),
				);
			},
		);

		async function verifyAliasedOverlay(overlayPath: string, concurrency: number) {
			const images = {
				"image.png": await solidImage("red"),
				"other.png": await solidImage("green"),
			};
			const overlay = await solidImage("blue");
			const expected = await SharpFactory(images["other.png"])
				.composite([{ input: overlay, blend: "difference" }])
				.png()
				.toBuffer();
			const options = {
				concurrency,
				buildTransform: (pipeline: Sharp) =>
					pipeline.composite([{ input: overlayPath, blend: "difference" }]).png(),
			};
			const first = await localImagesContext(images);
			files.writeFileSync("/download/test/image@sharp.png", overlay);
			const firstDerive = vi.spyOn(first.cache, "derive");
			await sharp(options).apply(first);
			// The task replacing its own aliased dependency is in-place and uncached.
			expect(firstDerive).toHaveBeenCalledTimes(1);
			expect(firstDerive.mock.calls[0]?.[0].outputs).toEqual(["other@sharp.png"]);
			expect(files.readFileSync("/download/test/other@sharp.png")).toEqual(expected);
			await publish(first);
			const next = await localImagesContext(images);
			files.writeFileSync("/download/test/image@sharp.png", overlay);
			files.unlinkSync("/download/test/other@sharp.png");
			const derive = vi.spyOn(next.cache, "derive");
			await sharp(options).apply(next);
			expect(derive).toHaveBeenCalledTimes(1);
			expect(await derive.mock.results[0]?.value).toEqual({ reused: true });
			expect(files.readFileSync("/download/test/other@sharp.png")).toEqual(expected);
		}

		it.each([1, 2])(
			"freezes overlay dependencies through a symlink ancestor (concurrency %s)",
			async (concurrency) => {
				const alias = filePath("source-alias");
				fs.symlinkSync(filePath("/download/test"), alias, "dir");
				await verifyAliasedOverlay(path.join(alias, "image@sharp.png"), concurrency);
			},
		);

		it("freezes differently cased overlay aliases on a case-insensitive filesystem", async ({
			skip,
		}) => {
			files.writeFileSync("case-probe", "probe");
			if (!files.existsSync("CASE-PROBE")) skip();
			await verifyAliasedOverlay(filePath("/download/test/IMAGE@SHARP.PNG"), 1);
		});

		it.each(["in-place", "unsupported"])(
			"rejects unsafe symlink ancestors before snapshots or %s writes",
			async (mode) => {
				const red = await solidImage("red");
				const blue = await solidImage("blue");
				const ctx = await localImagesContext({ "image.png": red });
				files.mkdirSync("outside", { recursive: true });
				files.writeFileSync("outside/image.png", red);
				files.writeFileSync("outside/image@sharp.png", blue);
				fs.symlinkSync(filePath("outside"), filePath("/download/test/linked"), "dir");
				const namespace = ctx.data.namespace("test")._unsafeUnwrap();
				await namespace
					.document("doc1")
					._unsafeUnwrap()
					.update(() => ({
						images: ["image.png", "linked/image.png", "linked/image@sharp.png"],
					}));
				const copy = vi.spyOn(fs.promises, "copyFile");
				await expect(
					sharp({
						concurrency: 1,
						buildTransform: (pipeline) => {
							if (mode === "in-place") {
								return pipeline.composite([{ input: filePath("outside/image@sharp.png") }]).png();
							}
							const transform = pipeline.png();
							const options: Record<string, unknown> = Object.getOwnPropertyDescriptor(
								transform,
								"options",
							)?.value;
							options.futureCallback = () => "unsupported";
							return transform;
						},
					}).apply(ctx),
				).rejects.toThrow("Unsafe artifact output");
				expect(copy).not.toHaveBeenCalled();
				expect(files.existsSync("temp")).toBe(false);
				expect(files.existsSync("/download/test/image@sharp.png")).toBe(false);
				expect(files.readFileSync("outside/image.png")).toEqual(red);
				expect(files.readFileSync("outside/image@sharp.png")).toEqual(blue);
				expect(fs.readdirSync(filePath("outside")).sort()).toEqual([
					"image.png",
					"image@sharp.png",
				]);
			},
		);

		it("allows symlink ancestors above the source root and reuses their outputs", async () => {
			fs.symlinkSync(filePath("download"), filePath("download-alias"), "dir");
			const options = { buildTransform: (pipeline: Sharp) => pipeline.png() };
			const first = await imageContext();
			first.paths.getDownloadPath = (sourceId) =>
				filePath(path.join("download-alias", sourceId ?? ""));
			await sharp(options).apply(first);
			const expected = files.readFileSync("/download/test/image@sharp.png");
			await publish(first);
			const next = await imageContext();
			next.paths.getDownloadPath = (sourceId) =>
				filePath(path.join("download-alias", sourceId ?? ""));
			files.unlinkSync("/download/test/image@sharp.png");
			const derive = vi.spyOn(next.cache, "derive");
			await sharp(options).apply(next);
			expect(await derive.mock.results[0]?.value).toEqual({ reused: true });
			expect(files.readFileSync("/download/test/image@sharp.png")).toEqual(expected);
		});

		it.each([
			[
				(pipeline: Sharp) => pipeline.jpeg({ quality: 80 }),
				(pipeline: Sharp) => pipeline.jpeg({ quality: 90 }),
			],
			[(pipeline: Sharp) => pipeline.resize(20), (pipeline: Sharp) => pipeline.resize(30)],
			[(pipeline: Sharp) => pipeline.rotate(15), (pipeline: Sharp) => pipeline.rotate(30)],
		])(
			"invalidates quality-only, width-only, and arbitrary rotation changes without changing legacy names",
			async (firstRecipe, changedRecipe) => {
				const first = await imageContext();
				await sharp({ buildTransform: firstRecipe, cacheKey: "fixed" }).apply(first);
				await publish(first);
				const next = await imageContext();
				const derive = vi.spyOn(next.cache, "derive");
				await sharp({ buildTransform: changedRecipe, cacheKey: "fixed" }).apply(next);
				expect(await derive.mock.results[0]?.value).toEqual({ reused: false });
				expect(
					files.existsSync("/download/test/image@sharp.jpg") ||
						files.existsSync("/download/test/image@sharp.jpeg"),
				).toBe(true);
			},
		);

		it("supplements automatic identity with cacheKey", async () => {
			const buildTransform = (pipeline: Sharp) => pipeline.resize(20);
			const first = await imageContext();
			await sharp({ buildTransform, cacheKey: "first" }).apply(first);
			await publish(first);
			const next = await imageContext();
			const derive = vi.spyOn(next.cache, "derive");
			await sharp({ buildTransform, cacheKey: "second" }).apply(next);
			expect(await derive.mock.results[0]?.value).toEqual({ reused: false });
		});

		it("fingerprints overlay contents, not merely the path", async () => {
			files.writeFileSync("/overlay.png", testImage);
			const buildTransform = (pipeline: Sharp) =>
				pipeline.composite([{ input: filePath("/overlay.png") }]);
			const first = await imageContext();
			await sharp({ buildTransform }).apply(first);
			await publish(first);
			files.writeFileSync(
				"/overlay.png",
				await SharpFactory({ create: { width: 1, height: 1, channels: 4, background: "red" } })
					.png()
					.toBuffer(),
			);
			const next = await imageContext();
			const derive = vi.spyOn(next.cache, "derive");
			await sharp({ buildTransform }).apply(next);
			expect(await derive.mock.results[0]?.value).toEqual({ reused: false });
			files.unlinkSync("/overlay.png");
			const missing = await imageContext();
			await expect(sharp({ buildTransform }).apply(missing)).rejects.toThrow("ENOENT");
		});

		it("isolates equal relative URLs by source and deduplicates within each source", async () => {
			const ctx = await imageContext(["first", "second"]);
			const derive = vi.spyOn(ctx.cache, "derive");
			await sharp({ buildTransform: (pipeline) => pipeline.resize(20), updateURLs: true }).apply(
				ctx,
			);
			expect(derive).toHaveBeenCalledTimes(2);
			expect(derive.mock.calls.map(([artifact]) => artifact.sourceId).sort()).toEqual([
				"first",
				"second",
			]);
			for (const source of ["first", "second"]) {
				expect(files.existsSync(`/download/${source}/image@sharp.jpg`)).toBe(true);
				const namespace = ctx.data.namespace(source)._unsafeUnwrap();
				expect(await namespace.document("doc1")._unsafeUnwrap()._read()).toEqual({
					images: ["image@sharp.jpg", "image@sharp.jpg"],
				});
			}
		});

		it("generates unsupported SVG recipes normally without allowing cacheKey to force caching", async () => {
			const ctx = await createTestPluginContext();
			files.mkdirSync("/download/test", { recursive: true });
			files.writeFileSync(
				"/download/test/image.svg",
				'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>',
			);
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert("doc1", Promise.resolve({ image: "image.svg" }));
			const derive = vi.spyOn(ctx.cache, "derive");
			await sharp({ buildTransform: (pipeline) => pipeline.png(), cacheKey: "force" }).apply(ctx);
			expect(derive).not.toHaveBeenCalled();
			expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("cache bypassed"));
			expect(files.existsSync("/download/test/image@sharp.png")).toBe(true);
		});

		it.each(["svg", "version", "function"])(
			"builds a %s fallback pipeline once and renders the dimensions used in its filename",
			async (reason) => {
				const ctx = await createTestPluginContext();
				files.mkdirSync("/download/test", { recursive: true });
				const extension = reason === "svg" ? "svg" : "jpg";
				for (const name of ["image", "other"]) {
					files.writeFileSync(
						`/download/test/${name}.${extension}`,
						reason === "svg"
							? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'
							: testImage,
					);
				}
				const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
				await namespace.insert(
					"doc1",
					Promise.resolve({
						images: [`image.${extension}`, `image.${extension}`, `other.${extension}`],
					}),
				);
				let calls = 0;
				const buildTransform = (pipeline: Sharp) => {
					calls++;
					const resolved = pipeline.resize(calls * 10, calls * 10).png();
					if (reason === "function") {
						const options: Record<string, unknown> = Object.getOwnPropertyDescriptor(
							resolved,
							"options",
						)?.value;
						options.futureCallback = () => "uncacheable";
					}
					return resolved;
				};
				const derive = vi.spyOn(ctx.cache, "derive");
				const claims = vi.spyOn(ctx.cache, "claimOutputs");
				const originalVersion = SharpFactory.versions.sharp;
				try {
					if (reason === "version") SharpFactory.versions.sharp = "0.36.0";
					await sharp({ buildTransform, updateURLs: true }).apply(ctx);
				} finally {
					SharpFactory.versions.sharp = originalVersion;
				}
				expect(calls).toBe(1);
				expect(derive).not.toHaveBeenCalled();
				expect(claims).toHaveBeenCalledTimes(2);
				expect(new Set(claims.mock.calls.map(([claim]) => claim.key)).size).toBe(2);
				for (const name of ["image", "other"]) {
					const output = `/download/test/${name}@10x10-crop.png`;
					expect(files.existsSync(output)).toBe(true);
					expect(await SharpFactory(files.readFileSync(output)).metadata()).toMatchObject({
						width: 10,
						height: 10,
					});
				}
				expect(await namespace.document("doc1")._unsafeUnwrap()._read()).toEqual({
					images: ["image@10x10-crop.png", "image@10x10-crop.png", "other@10x10-crop.png"],
				});
			},
		);

		it("rejects two unsupported transforms claiming the same output before overwriting it", async () => {
			const ctx = await createTestPluginContext();
			files.mkdirSync("/download/test", { recursive: true });
			files.writeFileSync(
				"/download/test/image.svg",
				'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
			);
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert("doc1", Promise.resolve({ image: "image.svg" }));
			const claims = vi.spyOn(ctx.cache, "claimOutputs");
			await sharp({ buildTransform: (pipeline) => pipeline.png({ compressionLevel: 1 }) }).apply(
				ctx,
			);
			const originalOutput = files.readFileSync("/download/test/image@sharp.png");
			await expect(
				sharp({ buildTransform: (pipeline) => pipeline.png({ compressionLevel: 9 }) }).apply(ctx),
			).rejects.toThrow("Different artifacts claim output");
			expect(files.readFileSync("/download/test/image@sharp.png")).toEqual(originalOutput);
			expect(claims.mock.calls[0]?.[0].key).not.toBe(claims.mock.calls[1]?.[0].key);
		});

		it.each(["version", "function"])(
			"rejects different inputs sharing an output within one %s fallback transform",
			async (reason) => {
				const ctx = await createTestPluginContext();
				files.mkdirSync("/download/test", { recursive: true });
				files.writeFileSync("/download/test/image.jpg", testImage);
				const otherImage = await SharpFactory({
					create: { width: 1, height: 1, channels: 3, background: "red" },
				})
					.png()
					.toBuffer();
				files.writeFileSync("/download/test/image.png", otherImage);
				const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
				await namespace.insert(
					"doc1",
					Promise.resolve({ images: ["image.jpg", "image.jpg", "image.png"] }),
				);
				const expectedOutput = await SharpFactory(testImage).webp().toBuffer();
				expect(expectedOutput).not.toEqual(await SharpFactory(otherImage).webp().toBuffer());
				const claims = vi.spyOn(ctx.cache, "claimOutputs");
				const originalVersion = SharpFactory.versions.sharp;
				try {
					if (reason === "version") SharpFactory.versions.sharp = "0.36.0";
					await expect(
						sharp({
							concurrency: 1,
							buildTransform: (pipeline) => {
								const resolved = pipeline.webp();
								if (reason === "function") {
									const options: Record<string, unknown> = Object.getOwnPropertyDescriptor(
										resolved,
										"options",
									)?.value;
									options.futureCallback = () => "uncacheable";
								}
								return resolved;
							},
						}).apply(ctx),
					).rejects.toMatchObject({ code: "output-conflict" });
				} finally {
					SharpFactory.versions.sharp = originalVersion;
				}
				expect(claims).toHaveBeenCalledTimes(2);
				expect(claims.mock.calls[0]?.[0].key).not.toBe(claims.mock.calls[1]?.[0].key);
				expect(files.readFileSync("/download/test/image@sharp.webp")).toEqual(expectedOutput);
			},
		);

		it("checks unsupported output claims against cacheable transforms", async () => {
			const ctx = await imageContext();
			await sharp({ buildTransform: (pipeline) => pipeline.png() }).apply(ctx);
			await expect(
				sharp({
					buildTransform: (pipeline) => {
						const resolved = pipeline.png();
						const options: Record<string, unknown> = Object.getOwnPropertyDescriptor(
							resolved,
							"options",
						)?.value;
						options.futureOption = true;
						return resolved;
					},
				}).apply(ctx),
			).rejects.toThrow("Different artifacts claim output");
		});

		it("invalidates when the input file changes under the same path and cacheKey", async () => {
			const options = { buildTransform: (pipeline: Sharp) => pipeline.png(), cacheKey: "fixed" };
			const first = await imageContext();
			await sharp(options).apply(first);
			await publish(first);
			const next = await imageContext();
			files.writeFileSync(
				"/download/test/image.jpg",
				await SharpFactory({ create: { width: 1, height: 1, channels: 3, background: "red" } })
					.png()
					.toBuffer(),
			);
			const derive = vi.spyOn(next.cache, "derive");
			await sharp(options).apply(next);
			expect(await derive.mock.results[0]?.value).toEqual({ reused: false });
		});

		it("generates normally on unsupported engine versions", async () => {
			const ctx = await imageContext();
			const derive = vi.spyOn(ctx.cache, "derive");
			const originalVersion = SharpFactory.versions.sharp;
			try {
				SharpFactory.versions.sharp = "0.36.0";
				await sharp({ buildTransform: (pipeline) => pipeline.resize(20), cacheKey: "force" }).apply(
					ctx,
				);
			} finally {
				SharpFactory.versions.sharp = originalVersion;
			}
			expect(derive).not.toHaveBeenCalled();
			expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("Unaudited Sharp"));
			expect(files.existsSync("/download/test/image@sharp.jpg")).toBe(true);
		});

		it("settles other queued jobs before returning a failure", async () => {
			const ctx = await imageContext();
			files.writeFileSync("/download/test/other.jpg", testImage);
			const inserted = await ctx.data
				.namespace("test")
				._unsafeUnwrap()
				.insert("other", Promise.resolve({ image: "other.jpg" }));
			inserted._unsafeUnwrap();
			const originalDerive = ctx.cache.derive.bind(ctx.cache);
			vi.spyOn(ctx.cache, "derive").mockImplementation(async (artifact) => {
				if (artifact.inputs[0] !== filePath("/download/test/other.jpg")) {
					throw new Error("first job failed");
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
				return originalDerive(artifact);
			});
			await expect(
				sharp({ buildTransform: (pipeline) => pipeline.resize(20), concurrency: 2 }).apply(ctx),
			).rejects.toThrow("first job failed");
			expect(files.existsSync("/download/test/other@sharp.jpg")).toBe(true);
		});

		it("rejects two different recipes claiming the same output in one run", async () => {
			const ctx = await imageContext();
			await sharp({ buildTransform: (pipeline) => pipeline.jpeg({ quality: 80 }) }).apply(ctx);
			await expect(
				sharp({ buildTransform: (pipeline) => pipeline.jpeg({ quality: 90 }) }).apply(ctx),
			).rejects.toThrow("Different artifacts claim output");
		});
	});
});
