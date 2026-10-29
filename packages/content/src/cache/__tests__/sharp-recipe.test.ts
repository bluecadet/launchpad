import { once } from "node:events";
import path from "node:path";
import { vol } from "memfs";
import Sharp, { type Sharp as SharpPipeline } from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareSharpRecipe, sharpInputDiagnostic } from "../sharp-recipe.js";

const image = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

function fingerprint(transform: SharpPipeline, cacheKey?: string) {
	const recipe = prepareSharpRecipe(transform, Sharp.versions, () => Sharp(), cacheKey);
	if (!recipe.cacheable) throw new Error(recipe.reason);
	return recipe.fingerprint;
}

function privateOptions(transform: SharpPipeline): Record<string, unknown> {
	return Object.getOwnPropertyDescriptor(transform, "options")?.value;
}

afterEach(() => vol.reset());

describe("Sharp recipe adapter", () => {
	it("is stable for equivalent pipelines and detaches options before streaming", () => {
		const original = Sharp().resize(20).jpeg({ quality: 85 });
		const initialFinishListeners = original.listenerCount("finish");
		const recipe = prepareSharpRecipe(original, Sharp.versions, () => Sharp());
		expect(original.listenerCount("finish")).toBe(initialFinishListeners);
		expect(recipe.cacheable).toBe(true);
		if (!recipe.cacheable) throw new Error(recipe.reason);
		expect(recipe.fingerprint).toBe(fingerprint(Sharp().resize(20).jpeg({ quality: 85 })));
		original.resize(40);
		expect(privateOptions(recipe.createPipeline(new Map())).width).toBe(20);
		expect(recipe.fingerprint).not.toBe(fingerprint(original));
	});

	it("processes a prepared pipeline whose input stream has already finished", async () => {
		const recipe = prepareSharpRecipe(Sharp().resize(2, 2).png(), Sharp.versions, () => Sharp());
		if (!recipe.cacheable) throw new Error(recipe.reason);
		const pipeline = recipe.createPipeline(new Map());
		const finished = once(pipeline, "finish");
		pipeline.end(image);
		await finished;

		const output = await pipeline.toBuffer();
		expect(await Sharp(output).metadata()).toMatchObject({ width: 2, height: 2, format: "png" });
	});

	it("clones unsupported callbacks without rebuilding or sharing mutable options", () => {
		const original = Sharp()
			.resize(10, 10)
			.composite([{ input: image }]);
		const callback = () => "unknown callback";
		privateOptions(original).futureCallback = callback;
		const createPipeline = vi.fn(() => Sharp());
		const recipe = prepareSharpRecipe(original, Sharp.versions, createPipeline);
		expect(createPipeline).not.toHaveBeenCalled();
		const cloned = recipe.createPipeline(new Map());
		expect(createPipeline).toHaveBeenCalledTimes(1);
		expect(privateOptions(cloned).futureCallback).toBe(callback);
		expect(privateOptions(cloned).width).toBe(10);
		expect(privateOptions(cloned).composite).toEqual(
			structuredClone(privateOptions(original).composite),
		);
		expect(privateOptions(cloned).composite).not.toBe(privateOptions(original).composite);
		original.resize(20, 20);
		expect(privateOptions(cloned).width).toBe(10);
		expect(original.listenerCount("finish")).toBe(0);
	});

	it.each([
		[Sharp().jpeg({ quality: 80 }), Sharp().jpeg({ quality: 90 })],
		[Sharp().resize(20), Sharp().resize(30)],
		[Sharp().rotate(15), Sharp().rotate(30)],
	])("includes quality-only, width-only, and arbitrary rotation changes", (first, second) => {
		expect(fingerprint(first)).not.toBe(fingerprint(second));
	});

	it("canonicalizes objects recursively but preserves ordered arrays", () => {
		const first = Sharp().withExif({ IFD0: { Copyright: "C", Artist: "A" } });
		const second = Sharp().withExif({ IFD0: { Artist: "A", Copyright: "C" } });
		expect(fingerprint(first)).toBe(fingerprint(second));
		expect(fingerprint(Sharp().linear([1, 2, 3], [0, 0, 0]))).not.toBe(
			fingerprint(Sharp().linear([3, 2, 1], [0, 0, 0])),
		);
	});

	it("includes exact buffer bytes, not object identity", () => {
		const first = Sharp().composite([{ input: image }]);
		const second = Sharp().composite([{ input: Buffer.from(image) }]);
		expect(fingerprint(first)).toBe(fingerprint(second));
		const modified = Buffer.from(image);
		modified[modified.length - 1] = 1;
		expect(fingerprint(first)).not.toBe(fingerprint(Sharp().composite([{ input: modified }])));
	});

	it("collects composite, join-channel, boolean and external ICC dependencies", () => {
		const recipe = prepareSharpRecipe(
			Sharp()
				.composite([{ input: "/overlay.png" }])
				.joinChannel("/channel.png")
				.boolean("/operand.png", "and")
				.withIccProfile("/profile.icc"),
			Sharp.versions,
			() => Sharp(),
		);
		expect(recipe.cacheable).toBe(true);
		if (!recipe.cacheable) throw new Error(recipe.reason);
		expect(recipe.dependencies).toEqual(
			["channel.png", "operand.png", "overlay.png", "profile.icc"]
				.map((filename) => path.resolve(path.parse(process.cwd()).root, filename))
				.sort(),
		);
		expect(recipe.loaderInputs).not.toContain(path.resolve("/profile.icc"));
		expect(
			prepareSharpRecipe(Sharp().withIccProfile("p3"), Sharp.versions, () => Sharp()),
		).toMatchObject({
			dependencies: [],
		});
	});

	it("remaps only explicit file slots at execution without changing the prepared identity", () => {
		const transform = Sharp()
			.composite([{ input: "/overlay.png" }])
			.joinChannel("/channel.png")
			.boolean("/operand.png", "and")
			.withIccProfile("/profile.icc")
			.withExif({ IFD0: { ImageDescription: "/overlay.png" } });
		const createPipeline = vi.fn(() => Sharp());
		const recipe = prepareSharpRecipe(transform, Sharp.versions, createPipeline);
		if (!recipe.cacheable) throw new Error(recipe.reason);
		const identity = recipe.fingerprint;
		expect(createPipeline).not.toHaveBeenCalled();
		const snapshotRoot = path.resolve("/snapshots");
		const snapshots = new Map(
			recipe.dependencies.map((input) => [input, path.join(snapshotRoot, path.basename(input))]),
		);
		const pipeline = recipe.createPipeline(snapshots);
		expect(privateOptions(pipeline)).toMatchObject({
			composite: [{ input: { file: path.join(snapshotRoot, "overlay.png") } }],
			joinChannelIn: [{ file: path.join(snapshotRoot, "channel.png") }],
			boolean: { file: path.join(snapshotRoot, "operand.png") },
			withIccProfile: path.join(snapshotRoot, "profile.icc"),
			withExif: { "exif-ifd0-ImageDescription": "/overlay.png" },
		});
		expect(recipe.fingerprint).toBe(identity);
		expect(privateOptions(transform)).toMatchObject({
			composite: [{ input: { file: "/overlay.png" } }],
		});
	});

	it("includes engine identity and treats cacheKey as additional identity", () => {
		const original = Sharp().jpeg({ quality: 80 });
		const changedEngine = prepareSharpRecipe(
			original,
			{ ...Sharp.versions, vips: "different" },
			() => Sharp(),
			"fixed",
		);
		expect(changedEngine).toMatchObject({ cacheable: true });
		if (!changedEngine.cacheable) throw new Error(changedEngine.reason);
		expect(changedEngine.fingerprint).not.toBe(fingerprint(original, "fixed"));
		expect(fingerprint(original, "first")).not.toBe(fingerprint(original, "second"));
		expect(fingerprint(original, "fixed")).not.toBe(
			fingerprint(Sharp().jpeg({ quality: 90 }), "fixed"),
		);
	});

	it.each(["0.35.3", "0.35.4", "0.35.6", "0.36.0"])(
		"fails closed for unaudited Sharp version %s even with a cache key",
		(version) => {
			expect(
				prepareSharpRecipe(Sharp(), { ...Sharp.versions, sharp: version }, () => Sharp(), "force"),
			).toMatchObject({ cacheable: false, reason: `Unaudited Sharp version '${version}'` });
		},
	);

	it("fails closed for unknown schema or functions", () => {
		const unknown = Sharp();
		privateOptions(unknown).futureOption = true;
		expect(prepareSharpRecipe(unknown, Sharp.versions, () => Sharp())).toMatchObject({
			cacheable: false,
			reason: expect.stringContaining("Unknown"),
		});
		const callback = Sharp();
		privateOptions(callback).withExif = { callback: () => "unsafe" };
		expect(prepareSharpRecipe(callback, Sharp.versions, () => Sharp(), "force")).toMatchObject({
			cacheable: false,
		});
	});

	it("does not cache text/font, SVG-buffer or nondeterministic noise recipes", () => {
		const pipelines = [
			Sharp().composite([{ input: { text: { text: "Hello" } } }]),
			Sharp().composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }]),
			Sharp().composite([
				{
					input: {
						create: {
							width: 10,
							height: 10,
							channels: 3,
							background: "black",
							noise: { type: "gaussian" },
						},
					},
				},
			]),
		];
		for (const transform of pipelines)
			expect(prepareSharpRecipe(transform, Sharp.versions, () => Sharp(), "force")).toMatchObject({
				cacheable: false,
			});
	});

	it("validates local loader resources and never turns missing files into a hit", async () => {
		vol.fromJSON({
			"/image.png": image,
			"/overlay.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
		});
		expect(await sharpInputDiagnostic(["/image.png"])).toBeUndefined();
		expect(await sharpInputDiagnostic(["/overlay.svg"])).toContain("unsupported");
		await expect(sharpInputDiagnostic(["/missing.png"])).rejects.toThrow("ENOENT");
	});
});
