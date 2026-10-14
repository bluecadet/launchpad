import { cp, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ArtifactCache,
	createArtifactCache,
	type DerivedArtifact,
} from "../artifact-cache.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

describe("artifact publication and filesystem safety", () => {
	let directory: string;
	let staged: string;
	let published: string;
	let input: string;
	let databasePath: string;
	const instances: ArtifactCache[] = [];

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-artifact-safety-"));
		staged = path.join(directory, "staged/source");
		published = path.join(directory, "published/source");
		input = path.join(directory, "input");
		databasePath = path.join(directory, "cache/artifacts.sqlite");
		await mkdir(staged, { recursive: true });
		await writeFile(input, "original input");
	});

	afterEach(async () => {
		for (const cache of instances.splice(0)) await cache.close();
		await rm(directory, { recursive: true, force: true });
	});

	async function openCache(overrides: Partial<Parameters<typeof createArtifactCache>[0]> = {}) {
		const cache = await createArtifactCache({
			databasePath,
			previousRoot: () => published,
			stagedRoot: () => staged,
			...overrides,
		});
		instances.push(cache);
		return cache;
	}

	function artifact(overrides: Partial<DerivedArtifact> = {}): DerivedArtifact {
		return {
			sourceId: "source",
			namespace: "test",
			version: "1",
			inputs: [input],
			options: null,
			outputs: ["output"],
			generate: async () => {
				await writeFile(path.join(staged, "output"), "generated");
			},
			...overrides,
		};
	}

	async function promote(cache: ArtifactCache) {
		await cp(staged, published, { recursive: true });
		await cache.commitPublication(() => published);
	}

	function count(table: "artifacts" | "unsafe_sources") {
		const database = new DatabaseSync(databasePath);
		try {
			return database.prepare(`SELECT * FROM ${table}`).all().length;
		} finally {
			database.close();
		}
	}

	it.each([false, true])(
		"begin drains background generation before journaling (inPlace=%s)",
		async (inPlace) => {
			const cache = await openCache();
			const started = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const target = path.join(staged, "output");
			await writeFile(target, "before");
			void cache.derive(
				artifact({
					inputs: inPlace ? [target] : [input],
					generate: async () => {
						started.resolve();
						await release.promise;
						await writeFile(target, "generated");
					},
				}),
			);
			await started.promise;
			let begun = false;
			const publication = cache.beginPublication(["source"]).then(() => {
				begun = true;
			});
			await Promise.resolve();
			expect(begun).toBe(false);
			expect(count("unsafe_sources")).toBe(0);
			await expect(cache.derive(artifact())).rejects.toMatchObject({ code: "publication" });
			await expect(
				cache.claimOutputs({ sourceId: "source", key: "late", outputs: ["late"] }),
			).rejects.toMatchObject({ code: "publication" });
			release.resolve();
			await publication;
			expect(count("unsafe_sources")).toBe(1);
			expect(await readFile(target, "utf8")).toBe("generated");
			await promote(cache);
			expect(count("artifacts")).toBe(inPlace ? 0 : 1);
		},
	);

	it("drains a derive accepted immediately before begin, including fingerprinting", async () => {
		const cache = await openCache();
		void cache.derive(artifact());
		await cache.beginPublication(["source"]);
		expect(await readFile(path.join(staged, "output"), "utf8")).toBe("generated");
		await promote(cache);
		expect(count("artifacts")).toBe(1);
	});

	it("allows accepted HTTP capture to finish after generation acceptance freezes", async () => {
		const cache = await openCache();
		await writeFile(path.join(staged, "output"), "http bytes");
		void cache.storeHttp({ sourceId: "source", key: "url", outputPath: "output", metadata: null });
		await cache.beginPublication(["source"]);
		await promote(cache);
		expect(count("artifacts")).toBe(1);
	});

	it.each([false, true])(
		"fails publication for background errors without unhandled rejection (alreadySettled=%s)",
		async (alreadySettled) => {
			const cache = await openCache();
			const started = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const failure = new Error("background generation failed");
			void cache.derive(
				artifact({
					generate: async () => {
						started.resolve();
						await release.promise;
						throw failure;
					},
				}),
			);
			await started.promise;
			if (alreadySettled) {
				release.resolve();
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
			const publication = expect(cache.beginPublication(["source"])).rejects.toMatchObject({
				code: "generation",
				cause: failure,
			});
			release.resolve();
			await publication;
			expect(count("unsafe_sources")).toBe(0);
			expect(count("artifacts")).toBe(0);
		},
	);

	it.each(["disabled", "unavailable"])(
		"rejects failed accepted generation before %s fallback",
		async (mode) => {
			if (mode === "unavailable") {
				await mkdir(path.dirname(databasePath), { recursive: true });
				await writeFile(databasePath, "corrupt SQLite");
			}
			const cache = await openCache(mode === "disabled" ? { enabled: false } : {});
			expect(cache.available).toBe(false);
			const started = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const cause = new Error("accepted generation failed");
			void cache.derive(
				artifact({
					generate: async () => {
						started.resolve();
						await release.promise;
						throw cause;
					},
				}),
			);
			await started.promise;
			const publication = expect(cache.beginPublication(["source"])).rejects.toMatchObject({
				code: "generation",
				cause,
			});
			release.resolve();
			await publication;
		},
	);

	it("rejects a staged hardlink before restore can overwrite a published sibling", async () => {
		const cache = await openCache();
		await cache.derive(artifact());
		await writeFile(path.join(staged, "sibling"), "published sibling must remain unchanged");
		await cache.beginPublication(["source"]);
		await promote(cache);
		await rm(path.join(staged, "output"));
		await link(path.join(published, "sibling"), path.join(staged, "output"));
		expect((await stat(path.join(staged, "output"))).nlink).toBeGreaterThan(1);
		const next = await openCache();
		const generate = vi.fn();
		await expect(next.derive(artifact({ generate }))).rejects.toThrow("multiply-linked file");
		expect(generate).not.toHaveBeenCalled();
		expect(await readFile(path.join(published, "sibling"), "utf8")).toBe(
			"published sibling must remain unchanged",
		);
		expect(await readFile(path.join(published, "output"), "utf8")).toBe("generated");
		expect(count("unsafe_sources")).toBe(0);
	});

	it.each(["custom", "http"])(
		"rejects hardlinked output files in pre-write %s claims",
		async (kind) => {
			const cache = await openCache();
			await link(input, path.join(staged, "output"));
			const claim =
				kind === "custom"
					? cache.claimOutputs({ sourceId: "source", key: "custom", outputs: ["output"] })
					: cache.claimHttp({ sourceId: "source", key: "url", outputPath: "output" });
			await expect(claim).rejects.toThrow("multiply-linked file");
			expect(await readFile(input, "utf8")).toBe("original input");
		},
	);

	it("permits directory link counts while validating nested output paths", async () => {
		const cache = await openCache();
		await mkdir(path.join(staged, "nested/child"), { recursive: true });
		await cache.claimOutputs({ sourceId: "source", key: "custom", outputs: ["nested/output"] });
	});

	it("rejects schema-valid derived rows owning different outputs", async () => {
		const cache = await openCache();
		await cache.derive(artifact());
		await cache.beginPublication(["source"]);
		await promote(cache);
		await writeFile(path.join(published, "unclaimed"), "generated");
		const database = new DatabaseSync(databasePath);
		database.exec(
			`UPDATE artifacts SET record_json = json_set(record_json, '$.outputs[0].path', 'unclaimed')`,
		);
		database.close();
		await rm(staged, { recursive: true });
		await mkdir(staged);
		const next = await openCache();
		expect(await next.derive(artifact())).toEqual({ reused: false });
		expect(await readFile(path.join(staged, "output"), "utf8")).toBe("generated");
		await expect(stat(path.join(staged, "unclaimed"))).rejects.toThrow();
	});

	it("rejects schema-valid HTTP rows owning a different output", async () => {
		const cache = await openCache();
		await writeFile(path.join(staged, "output"), "http bytes");
		await cache.storeHttp({ sourceId: "source", key: "url", outputPath: "output", metadata: null });
		await cache.beginPublication(["source"]);
		await promote(cache);
		const database = new DatabaseSync(databasePath);
		database.exec(
			`UPDATE artifacts SET record_json = json_set(record_json, '$.outputs[0].path', 'unclaimed')`,
		);
		database.close();
		const next = await openCache();
		expect(
			await next.lookupHttp({ sourceId: "source", key: "url", outputPath: "output" }),
		).toBeUndefined();
	});

	it("does not cache output under an input identity changed while generation was running", async () => {
		const cache = await openCache();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const work = cache.derive(
			artifact({
				generate: async () => {
					started.resolve();
					await release.promise;
					await writeFile(path.join(staged, "output"), await readFile(input));
				},
			}),
		);
		await started.promise;
		await writeFile(input, "changed input during generation");
		release.resolve();
		await work;
		await cache.beginPublication(["source"]);
		await promote(cache);
		expect(count("artifacts")).toBe(0);
		await writeFile(input, "original input");
		const next = await openCache();
		expect(await next.derive(artifact())).toEqual({ reused: false });
	});

	it("does not coalesce a later request against generation with unstable inputs", async () => {
		const cache = await openCache();
		await cache.derive(
			artifact({
				generate: async () => {
					await writeFile(input, "changed input");
					await writeFile(path.join(staged, "output"), "unstable result");
				},
			}),
		);
		await writeFile(input, "original input");
		const generate = vi.fn(artifact().generate);
		await cache.derive(artifact({ generate }));
		expect(generate).toHaveBeenCalledOnce();
		expect(await readFile(path.join(staged, "output"), "utf8")).toBe("generated");
	});

	it("treats a dependency removed during generation as an error", async () => {
		const cache = await openCache();
		await expect(
			cache.derive(
				artifact({
					generate: async () => {
						await rm(input);
						await writeFile(path.join(staged, "output"), "generated");
					},
				}),
			),
		).rejects.toMatchObject({ code: "invalid-artifact" });
		await expect(cache.beginPublication(["source"])).rejects.toMatchObject({ code: "generation" });
	});

	it.each(["aliased-root", "aliased-input"])(
		"recognizes in-place work through an allowed symlink ancestor (%s)",
		async (aliasDirection) => {
			const alias = path.join(directory, "alias");
			await symlink(path.dirname(staged), alias, "dir");
			const aliasRoot = path.join(alias, "source");
			const cache = await openCache({
				stagedRoot: () => (aliasDirection === "aliased-root" ? aliasRoot : staged),
			});
			const original = path.join(staged, "output");
			await writeFile(original, "download bytes");
			await cache.storeHttp({
				sourceId: "source",
				key: "url",
				outputPath: "output",
				metadata: null,
			});
			const inputPath =
				aliasDirection === "aliased-input" ? path.join(aliasRoot, "output") : original;
			const generate = vi.fn(async () => {
				await writeFile(original, "downstream bytes");
			});
			expect(await cache.derive(artifact({ inputs: [inputPath], generate }))).toEqual({
				reused: false,
			});
			expect(generate).toHaveBeenCalledOnce();
			expect(await readFile(original, "utf8")).toBe("downstream bytes");
			await cache.beginPublication(["source"]);
			await promote(cache);
			expect(count("artifacts")).toBe(0);
		},
	);

	it("uses canonical input names for repeated mixed in-place recipe reservations", async () => {
		const alias = path.join(directory, "alias");
		await symlink(path.dirname(staged), alias, "dir");
		const aliasRoot = path.join(alias, "source");
		const cache = await openCache({ stagedRoot: () => aliasRoot });
		const original = path.join(staged, "output");
		await writeFile(original, "download bytes");
		await cache.storeHttp({ sourceId: "source", key: "url", outputPath: "output", metadata: null });
		const generate = vi.fn(async () => {
			await writeFile(original, "downstream bytes");
			await writeFile(path.join(staged, "distinct"), "distinct bytes");
		});
		const request = artifact({ inputs: [original], outputs: ["output", "distinct"], generate });
		expect(await cache.derive(request)).toEqual({ reused: false });
		expect(await cache.derive({ ...request, inputs: [path.join(aliasRoot, "output")] })).toEqual({
			reused: false,
		});
		expect(generate).toHaveBeenCalledTimes(2);
		await cache.beginPublication(["source"]);
		await promote(cache);
		expect(count("artifacts")).toBe(0);
	});

	it("keeps distinct reservations atomic when an in-place destination has an ancestor alias", async () => {
		const alias = path.join(directory, "alias");
		await symlink(path.dirname(staged), alias, "dir");
		const cache = await openCache({ stagedRoot: () => path.join(alias, "source") });
		const original = path.join(staged, "output");
		await writeFile(original, "download bytes");
		await cache.storeHttp({ sourceId: "source", key: "url", outputPath: "output", metadata: null });
		await cache.claimOutputs({ sourceId: "source", key: "owner", outputs: ["distinct"] });
		const generate = vi.fn();
		await expect(
			cache.derive(
				artifact({
					inputs: [original],
					outputs: ["output", "unowned", "distinct"],
					generate,
				}),
			),
		).rejects.toThrow(/Different artifacts claim output: .*distinct$/);
		expect(generate).not.toHaveBeenCalled();
		expect(await readFile(original, "utf8")).toBe("download bytes");
		await cache.claimOutputs({ sourceId: "source", key: "independent", outputs: ["unowned"] });
	});

	it.each(["photo.jpg", "PHOTO.JPG"])(
		"classifies %s according to the filesystem's measured case behavior",
		async (output) => {
			const cache = await openCache();
			const original = path.join(staged, "Photo.JPG");
			const destination = path.join(staged, output);
			await writeFile(original, "download bytes");
			const originalAttributes = await stat(original);
			const aliases = await stat(destination).then(
				(attributes) =>
					attributes.dev === originalAttributes.dev && attributes.ino === originalAttributes.ino,
				(error: unknown) => {
					if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
					throw error;
				},
			);
			await cache.storeHttp({
				sourceId: "source",
				key: "url",
				outputPath: "Photo.JPG",
				metadata: null,
			});
			const generate = vi.fn(async () => {
				await writeFile(destination, "downstream bytes");
			});
			expect(
				await cache.derive(artifact({ inputs: [original], outputs: [output], generate })),
			).toEqual({ reused: false });
			expect(generate).toHaveBeenCalledOnce();
			expect(await readFile(destination, "utf8")).toBe("downstream bytes");
			expect(await readFile(original, "utf8")).toBe(
				aliases ? "downstream bytes" : "download bytes",
			);
			await cache.beginPublication(["source"]);
			await promote(cache);
			expect(count("artifacts")).toBe(aliases ? 0 : 2);
		},
	);

	it.each(["ancestor", "file", "root"])(
		"rejects symlink %s before output generation",
		async (kind) => {
			const cache = await openCache();
			const outside = path.join(directory, "outside");
			await mkdir(outside);
			const target = kind === "root" ? staged : path.join(staged, "linked");
			if (kind === "root") await rm(staged, { recursive: true });
			const linkedTarget = kind === "file" ? path.join(outside, "file") : outside;
			if (kind === "file") await writeFile(linkedTarget, "untouched");
			await symlink(linkedTarget, target);
			const generate = vi.fn();
			await expect(
				cache.derive(
					artifact({
						outputs: [
							kind === "ancestor" ? "linked/escape" : kind === "file" ? "linked" : "escape",
						],
						generate,
					}),
				),
			).rejects.toThrow("symbolic link");
			expect(generate).not.toHaveBeenCalled();
			await expect(stat(path.join(outside, "escape"))).rejects.toThrow();
		},
	);

	it("misses previous symlink outputs and does not persist final symlink replacements", async () => {
		const cache = await openCache();
		await cache.derive(artifact());
		await cache.beginPublication(["source"]);
		await promote(cache);
		const outside = path.join(directory, "outside");
		await writeFile(outside, "generated");
		await rm(path.join(published, "output"));
		await symlink(outside, path.join(published, "output"));
		const next = await openCache();
		expect(await next.derive(artifact())).toEqual({ reused: false });
		await next.beginPublication(["source"]);
		await next.commitPublication(() => published);
		expect(count("artifacts")).toBe(0);
	});

	it.each(["http", "derived", "custom"])(
		"mixed in-place recipes cannot overwrite distinct outputs claimed by %s work",
		async (owner) => {
			const cache = await openCache();
			const inPlace = path.join(staged, "output");
			const distinct = path.join(staged, "other");
			await writeFile(inPlace, "before");
			await writeFile(distinct, "owned bytes");
			if (owner === "http") {
				await cache.storeHttp({
					sourceId: "source",
					key: "url",
					outputPath: "other",
					metadata: null,
				});
			} else if (owner === "derived") {
				await cache.derive(artifact({ outputs: ["other"], generate: async () => {} }));
			} else {
				await cache.claimOutputs({ sourceId: "source", key: "owner", outputs: ["other"] });
			}
			const generate = vi.fn(async () => {
				await writeFile(inPlace, "mutated");
				await writeFile(distinct, "clobbered");
			});
			await expect(
				cache.derive(
					artifact({ inputs: [inPlace], outputs: ["output", "unowned", "other"], generate }),
				),
			).rejects.toMatchObject({ code: "output-conflict" });
			expect(generate).not.toHaveBeenCalled();
			expect(await readFile(inPlace, "utf8")).toBe("before");
			expect(await readFile(distinct, "utf8")).toBe("owned bytes");
			// The failed multi-output reservation must not partially claim another destination.
			await cache.claimOutputs({ sourceId: "source", key: "independent", outputs: ["unowned"] });
		},
	);

	it("mixed in-place work remains uncached while reserving its distinct destinations", async () => {
		const cache = await openCache();
		const inputPath = path.join(staged, "output");
		await writeFile(inputPath, "before");
		const generate = vi.fn(async () => {
			await writeFile(inputPath, "after");
			await writeFile(path.join(staged, "other"), "distinct output");
		});
		const request = artifact({ inputs: [inputPath], outputs: ["output", "other"], generate });
		expect(await cache.derive(request)).toEqual({ reused: false });
		expect(await cache.derive(request)).toEqual({ reused: false });
		expect(generate).toHaveBeenCalledTimes(2);
		await cache.beginPublication(["source"]);
		await promote(cache);
		expect(count("artifacts")).toBe(0);
	});

	it("different mixed in-place recipes conflict only on their distinct destinations", async () => {
		const cache = await openCache();
		const inputPath = path.join(staged, "output");
		await writeFile(inputPath, "before");
		const generate = vi.fn(async () => {
			await writeFile(path.join(staged, "other"), "distinct output");
		});
		const request = artifact({ inputs: [inputPath], outputs: ["output", "other"], generate });
		await cache.derive(request);
		await expect(cache.derive({ ...request, version: "2" })).rejects.toMatchObject({
			code: "output-conflict",
		});
		expect(generate).toHaveBeenCalledOnce();
	});

	it("generic uncached claims conflict with other identities without using HTTP records", async () => {
		const cache = await openCache();
		await cache.claimOutputs({ sourceId: "source", key: "recipe-1", outputs: ["output"] });
		await cache.claimOutputs({ sourceId: "source", key: "recipe-1", outputs: ["./output"] });
		await expect(
			cache.claimOutputs({ sourceId: "source", key: "recipe-2", outputs: ["output"] }),
		).rejects.toMatchObject({ code: "output-conflict" });
		await expect(
			cache.claimHttp({ sourceId: "source", key: "url", outputPath: "output" }),
		).rejects.toMatchObject({ code: "output-conflict" });
		expect(count("artifacts")).toBe(0);
	});

	it.each(["Photo.jpg", "Nested/Photo.jpg"])(
		"preserves output ownership after creating a previously missing %s",
		async (output) => {
			const cache = await openCache();
			await cache.claimOutputs({ sourceId: "source", key: "first", outputs: [output] });
			const destination = path.join(staged, output);
			await mkdir(path.dirname(destination), { recursive: true });
			await writeFile(destination, "owned bytes");
			await expect(
				cache.claimOutputs({ sourceId: "source", key: "second", outputs: [output] }),
			).rejects.toMatchObject({ code: "output-conflict" });

			const alias = path.join(path.dirname(output), "PHOTO.JPG");
			const original = await stat(destination);
			const aliases = await stat(path.join(staged, alias)).then(
				(attributes) => attributes.dev === original.dev && attributes.ino === original.ino,
				(error: unknown) => {
					if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
					throw error;
				},
			);
			const claim = cache.claimOutputs({ sourceId: "source", key: "third", outputs: [alias] });
			if (aliases) await expect(claim).rejects.toMatchObject({ code: "output-conflict" });
			else await expect(claim).resolves.toBeUndefined();
			expect(await readFile(destination, "utf8")).toBe("owned bytes");
		},
	);

	it("honors the filesystem's case sensitivity for distinct output claims", async () => {
		const cache = await openCache();
		await writeFile(path.join(staged, "CaseProbe"), "probe");
		let sensitive = false;
		try {
			await stat(path.join(staged, "caseprobe"));
		} catch {
			sensitive = true;
		}
		await cache.claimOutputs({ sourceId: "source", key: "upper", outputs: ["CaseOutput"] });
		const lower = cache.claimOutputs({ sourceId: "source", key: "lower", outputs: ["caseoutput"] });
		if (sensitive) await expect(lower).resolves.toBeUndefined();
		else await expect(lower).rejects.toMatchObject({ code: "output-conflict" });
	});
});
