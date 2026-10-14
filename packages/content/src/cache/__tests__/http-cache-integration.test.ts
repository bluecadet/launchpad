import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ArtifactCache, createArtifactCache } from "../artifact-cache.js";
import { downloadHttpArtifact, HttpCachePolicy, type HttpDownloadOptions } from "../http-cache.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

describe("HTTP artifacts (real files, SQLite and fixture server)", () => {
	let directory: string;
	let cache: ArtifactCache;
	let origin: string;
	let requests: IncomingMessage[];
	let respond: (request: IncomingMessage, response: ServerResponse) => void;
	const server = createServer((request, response) => {
		requests.push(request);
		respond(request, response);
	});

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-http-"));
		requests = [];
		respond = (_request, response) => {
			response.writeHead(200, { "cache-control": "max-age=60", etag: '"v1"' });
			response.end("first body");
		};
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Fixture server has no port");
		origin = `http://127.0.0.1:${address.port}`;
		cache = await openCache();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await cache.close();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		await rm(directory, { force: true, recursive: true });
	});

	function openCache() {
		return createArtifactCache({
			databasePath: path.join(directory, "cache.sqlite"),
			previousRoot: (sourceId) => path.join(directory, "published", sourceId),
			stagedRoot: (sourceId) => path.join(directory, "staged", sourceId),
		});
	}

	function download(overrides: Partial<HttpDownloadOptions> = {}) {
		const sourceId = overrides.sourceId ?? "source";
		const outputPath = overrides.outputPath ?? "image.jpg";
		return downloadHttpArtifact({
			cache,
			sourceId,
			outputPath,
			url: `${origin}/image.jpg`,
			signal: new AbortController().signal,
			timeout: 2000,
			...overrides,
		});
	}

	async function publishAndReopen(sources = ["source"]) {
		await cache.beginPublication(sources);
		await cp(path.join(directory, "staged"), path.join(directory, "published"), {
			recursive: true,
		});
		await cache.commitPublication((sourceId) => path.join(directory, "published", sourceId));
		await cache.close();
		await rm(path.join(directory, "staged"), { recursive: true, force: true });
		cache = await openCache();
	}

	it("skips network only for fresh, verified published bytes", async () => {
		expect(await download()).toEqual({ cacheHit: false });
		await publishAndReopen();
		expect(await download()).toEqual({ cacheHit: true });
		expect(requests).toHaveLength(1);
		expect(await readFile(path.join(directory, "staged/source/image.jpg"), "utf8")).toBe(
			"first body",
		);
	});

	it("obtains the only writable destination from the cache claim", async () => {
		const unrelated = path.join(directory, "unrelated");
		await writeFile(unrelated, "untouched");
		const legacyOption = { filePath: unrelated };
		const claim = vi.spyOn(cache, "claimHttp");
		expect(await download({ ...legacyOption, outputPath: "nested/image.jpg" })).toEqual({
			cacheHit: false,
		});
		expect(await claim.mock.results[0]?.value).toBe(
			path.join(directory, "staged/source/nested/image.jpg"),
		);
		expect(await readFile(path.join(directory, "staged/source/nested/image.jpg"), "utf8")).toBe(
			"first body",
		);
		expect(await readFile(unrelated, "utf8")).toBe("untouched");
	});

	it.each(["../escaped", "/absolute-output"])(
		"rejects unsafe HTTP destination %s before requesting or writing bytes",
		async (outputPath) => {
			await expect(download({ outputPath })).rejects.toThrow(/escapes|Invalid/);
			expect(requests).toHaveLength(0);
			await expect(readFile(path.join(directory, "staged/escaped"))).rejects.toThrow();
		},
	);

	it("counts body transfer time against an upstream Age freshness lifetime", async () => {
		const start = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(start);
		const policyCreated = Promise.withResolvers<void>();
		const originalCreate = HttpCachePolicy.create;
		vi.spyOn(HttpCachePolicy, "create").mockImplementation((...arguments_) => {
			const policy = originalCreate(...arguments_);
			policyCreated.resolve();
			return policy;
		});
		const responseStarted = Promise.withResolvers<ServerResponse>();
		respond = (_request, response) => {
			response.writeHead(200, {
				"cache-control": "max-age=60",
				age: "50",
				date: new Date(start).toUTCString(),
			});
			response.write("first ");
			responseStarted.resolve(response);
		};
		const task = download();
		const response = await responseStarted.promise;
		// Policy creation must happen while the body is still incomplete.
		await policyCreated.promise;
		clock.mockReturnValue(start + 20_000);
		response.end("body");
		expect(await task).toEqual({ cacheHit: false });
		await publishAndReopen();
		respond = (_request, nextResponse) => {
			nextResponse.writeHead(200, { "cache-control": "max-age=60" });
			nextResponse.end("second body");
		};
		expect(await download()).toEqual({ cacheHit: false });
		expect(requests).toHaveLength(2);
	});

	it.each([404, 206])("cancels an indefinitely streaming rejected HTTP %s body", async (status) => {
		let closed = false;
		respond = (_request, response) => {
			response.on("close", () => {
				closed = true;
			});
			response.writeHead(status);
			response.write("rejected body never finishes");
		};
		await expect(download()).rejects.toThrow(`HTTP ${status}`);
		await expect.poll(() => closed, { timeout: 1000 }).toBe(true);
	});

	it("does not wait for an unrelated consumer of a cloned error response", async () => {
		const original = new Response("body", { status: 404 });
		const response = original.clone();
		vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
		await expect(download()).rejects.toThrow("HTTP 404");
		expect(response.bodyUsed).toBe(true);
		expect(original.bodyUsed).toBe(false);
		// The downloader releases its branch without taking ownership of the other one.
		expect(await original.text()).toBe("body");
	});

	it("cancels an indefinitely streaming server error after stale fallback", async () => {
		respond = (_request, response) => {
			response.writeHead(200, { "cache-control": "max-age=0, stale-if-error=60" });
			response.end("first body");
		};
		await download();
		await publishAndReopen();
		let closed = false;
		respond = (_request, response) => {
			response.on("close", () => {
				closed = true;
			});
			response.writeHead(503);
			response.write("error body never finishes");
		};
		expect(await download()).toEqual({ cacheHit: true });
		await expect.poll(() => closed, { timeout: 1000 }).toBe(true);
	});

	it("cancels an unconsumed response when directory creation fails", async () => {
		await mkdir(path.join(directory, "staged/source"), { recursive: true });
		await writeFile(path.join(directory, "staged/source/blocking"), "not a directory");
		let closed = false;
		respond = (_request, response) => {
			response.on("close", () => {
				closed = true;
			});
			response.writeHead(200);
			response.write("body never finishes");
		};
		await expect(download({ outputPath: "blocking/nested" })).rejects.toMatchObject({
			kind: "filesystem",
		});
		await expect.poll(() => closed, { timeout: 1000 }).toBe(true);
	});

	it.each(["missing", "mutated"])(
		"uses unconditional GET when the previous body is %s",
		async (condition) => {
			await download();
			await publishAndReopen();
			const body = path.join(directory, "published/source/image.jpg");
			if (condition === "missing") await rm(body);
			else {
				await writeFile(body, "other body");
				await utimes(body, new Date(), new Date(Date.now() + 2000));
			}
			expect(await download()).toEqual({ cacheHit: false });
			expect(requests[1]?.headers["if-none-match"]).toBeUndefined();
			expect(requests[1]?.headers["if-modified-since"]).toBeUndefined();
		},
	);

	it("conditionally GETs stale entries with origin validators and persists 304 header updates", async () => {
		const modified = "Wed, 01 Jan 2020 00:00:00 GMT";
		respond = (_request, response) => {
			response.writeHead(200, {
				"cache-control": "max-age=0",
				etag: '"v1"',
				"last-modified": modified,
			});
			response.end("first body");
		};
		await download();
		await publishAndReopen();
		respond = (_request, response) => {
			response.writeHead(304, { "cache-control": "max-age=60", etag: '"v1"', vary: "Accept" });
			response.end();
		};
		expect(await download()).toEqual({ cacheHit: true });
		expect(requests[1]?.method).toBe("GET");
		expect(requests[1]?.headers["if-none-match"]).toBe('"v1"');
		expect(requests[1]?.headers["if-modified-since"]).toBe(modified);
		await publishAndReopen();
		expect(await download()).toEqual({ cacheHit: true });
		expect(requests).toHaveLength(2);
	});

	it("retries an invalid 304 unconditionally instead of publishing the old body", async () => {
		respond = (_request, response) => {
			response.writeHead(200, { "cache-control": "max-age=0", etag: '"v1"' });
			response.end("first body");
		};
		await download();
		await publishAndReopen();
		respond = (request, response) => {
			if (request.headers["if-none-match"]) {
				response.writeHead(304, { etag: '"wrong"' });
				response.end();
				return;
			}
			response.writeHead(200, { etag: '"v2"' });
			response.end("other body");
		};
		expect(await download()).toEqual({ cacheHit: false });
		expect(requests).toHaveLength(3);
		expect(requests[2]?.headers["if-none-match"]).toBeUndefined();
		expect(await readFile(path.join(directory, "staged/source/image.jpg"), "utf8")).toBe(
			"other body",
		);
	});

	it.each(["no explicit lifetime", "no-store", "no-cache", "vary wildcard"])(
		"does not treat %s as a fresh reusable response",
		async (condition) => {
			const values: Record<string, string> = { etag: '"v1"' };
			if (condition === "no-store") values["cache-control"] = "no-store, max-age=60";
			if (condition === "no-cache") values["cache-control"] = "no-cache, max-age=60";
			if (condition === "vary wildcard")
				Object.assign(values, { "cache-control": "max-age=60", vary: "*" });
			respond = (_request, response) => {
				response.writeHead(200, values);
				response.end("same size!");
			};
			await download();
			await publishAndReopen();
			expect(await download()).toEqual({ cacheHit: false });
			expect(requests).toHaveLength(2);
			expect(requests.every((request) => request.method === "GET")).toBe(true);
			if (condition === "no-store" || condition === "vary wildcard")
				expect(requests[1]?.headers["if-none-match"]).toBeUndefined();
		},
	);

	it.each([
		"max-age=0, stale-if-error=60",
		"max-age=0",
		"max-age=0, stale-if-error=60, must-revalidate",
	])("gates server error fallback on %s", async (control) => {
		respond = (_request, response) => {
			response.writeHead(200, { "cache-control": control });
			response.end("first body");
		};
		await download();
		await publishAndReopen();
		respond = (_request, response) => {
			response.writeHead(503);
			response.end();
		};
		if (control === "max-age=0, stale-if-error=60")
			expect(await download()).toEqual({ cacheHit: true });
		else await expect(download()).rejects.toThrow("HTTP 503");
	});

	it("bypasses a fresh entry with a full GET", async () => {
		await download();
		await publishAndReopen();
		expect(await download({ ignoreCache: true })).toEqual({ cacheHit: false });
		expect(requests).toHaveLength(2);
		expect(requests[1]?.headers["if-none-match"]).toBeUndefined();
	});

	it("isolates sources and request variants, and claims conflicting destinations before writes", async () => {
		await download();
		await download({ sourceId: "second" });
		await publishAndReopen(["source", "second"]);
		expect(await download({ sourceId: "third" })).toEqual({ cacheHit: false });
		expect(await download({ sourceId: "second" })).toEqual({ cacheHit: true });
		expect(await download({ headers: new Headers({ accept: "image/png" }) })).toEqual({
			cacheHit: false,
		});
		await expect(download({ url: `${origin}/other.jpg` })).rejects.toMatchObject({
			code: "output-conflict",
		});
		expect(requests).toHaveLength(4);
	});

	it("assigns distinct artifact keys to raw request values even when policy normalization matches", async () => {
		const first = new Headers({ "cache-control": 'Extension="a,b"' });
		const second = new Headers({ "cache-control": 'Extension="c,d"' });
		respond = (request, response) => {
			response.writeHead(200, {
				"cache-control": "max-age=60",
				vary: "Cache-Control",
				etag: '"v1"',
			});
			response.end(request.headers["cache-control"]);
		};
		const firstClaims = vi.spyOn(cache, "claimHttp");
		expect(await download({ headers: first })).toEqual({ cacheHit: false });
		const firstKey = firstClaims.mock.calls[0]?.[0].key;
		expect(firstKey).toBeDefined();
		await publishAndReopen();
		const secondClaims = vi.spyOn(cache, "claimHttp");
		expect(await download({ headers: second })).toEqual({ cacheHit: false });
		const secondKey = secondClaims.mock.calls[0]?.[0].key;
		expect(secondKey).toBeDefined();
		expect(secondKey).not.toBe(firstKey);
		expect(requests).toHaveLength(2);
		expect(requests[1]?.headers["if-none-match"]).toBeUndefined();
		expect(await readFile(path.join(directory, "staged/source/image.jpg"), "utf8")).toBe(
			'Extension="c,d"',
		);
	});

	it("coalesces identical in-flight work per source and cache instance", async () => {
		const results = await Promise.all([download(), download(), download()]);
		expect(results).toEqual([{ cacheHit: false }, { cacheHit: false }, { cacheHit: false }]);
		expect(requests).toHaveLength(1);
	});

	it.each([true, false])(
		"permits transport failures only with server stale-if-error (%s)",
		async (allowed) => {
			respond = (_request, response) => {
				response.writeHead(200, {
					"cache-control": allowed ? "max-age=0, stale-if-error=60" : "max-age=0",
				});
				response.end("first body");
			};
			await download();
			await publishAndReopen();
			respond = (request) => request.socket.destroy();
			if (allowed) expect(await download()).toEqual({ cacheHit: true });
			else await expect(download()).rejects.toThrow("Media GET failed");
		},
	);

	it("permits request timeouts only with an applicable server error window", async () => {
		respond = (_request, response) => {
			response.writeHead(200, { "cache-control": "max-age=0, stale-if-error=60" });
			response.end("first body");
		};
		await download();
		await publishAndReopen();
		respond = () => {};
		expect(await download({ timeout: 20 })).toEqual({ cacheHit: true });
	});

	it("does not use stale after a mismatched 304 followed by a server error", async () => {
		respond = (_request, response) => {
			response.writeHead(200, { "cache-control": "max-age=0, stale-if-error=60", etag: '"v1"' });
			response.end("first body");
		};
		await download();
		await publishAndReopen();
		respond = (request, response) => {
			response.writeHead(request.headers["if-none-match"] ? 304 : 503, { etag: '"wrong"' });
			response.end();
		};
		await expect(download()).rejects.toThrow("HTTP 503");
	});

	it("never falls back for cancellation or local filesystem failure", async () => {
		respond = (_request, response) => {
			response.writeHead(200, { "cache-control": "max-age=0, stale-if-error=60" });
			response.end("first body");
		};
		await download();
		await publishAndReopen();
		const controller = new AbortController();
		controller.abort();
		await expect(download({ signal: controller.signal })).rejects.toThrow();
		expect(requests).toHaveLength(1);
		await mkdir(path.join(directory, "staged/source"), { recursive: true });
		await writeFile(path.join(directory, "staged/source/image.jpg"), "blocking directory");
		await expect(download({ outputPath: "image.jpg/nested" })).rejects.toMatchObject({
			kind: "filesystem",
		});
	});
});
