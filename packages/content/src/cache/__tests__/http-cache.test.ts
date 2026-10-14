import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpCachePolicy } from "../http-cache.js";

const url = "https://example.com/image.jpg?size=2";
const headers = new Headers({ accept: "image/webp" });
function policy(values: Record<string, string> = {}, requestHeaders = headers) {
	return HttpCachePolicy.create(url, requestHeaders, {
		status: 200,
		headers: new Headers({ date: new Date().toUTCString(), ...values }),
	});
}

afterEach(() => vi.useRealTimers());

describe("private HTTP cache policy", () => {
	it("requires an explicit lifetime, never heuristic or immutable-only freshness", () => {
		const responses: Record<string, string>[] = [
			{ "last-modified": "Wed, 01 Jan 2020 00:00:00 GMT" },
			{ "cache-control": "immutable" },
			{ "cache-control": "public" },
		];
		for (const values of responses) {
			expect(policy(values).fresh(url, headers)).toBe(false);
		}
		expect(policy({ "cache-control": "private, max-age=60" }).fresh(url, headers)).toBe(true);
		expect(
			policy({ expires: new Date(Date.now() + 60000).toUTCString() }).fresh(url, headers),
		).toBe(true);
	});

	it("uses server Date and Age, including across serialization", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const entry = policy({ "cache-control": "max-age=60", age: "50" });
		expect(entry.fresh(url, headers)).toBe(true);
		vi.advanceTimersByTime(11000);
		expect(HttpCachePolicy.restore(entry.serialize())?.fresh(url, headers)).toBe(false);
		expect(
			policy({ "cache-control": "max-age=60", date: "Wed, 31 Dec 2025 23:00:00 GMT" }).fresh(
				url,
				headers,
			),
		).toBe(false);
	});

	it("uses ETag and Last-Modified validators, never filesystem timestamps", () => {
		const entry = policy({ etag: '"origin-1"', "last-modified": "Wed, 01 Jan 2020 00:00:00 GMT" });
		const conditional = entry.conditionalHeaders(url, headers);
		expect(conditional.get("if-none-match")).toBe('"origin-1"');
		expect(conditional.get("if-modified-since")).toBe("Wed, 01 Jan 2020 00:00:00 GMT");
		expect(entry.conditionalHeaders(`${url}x`, headers).has("if-none-match")).toBe(false);
	});

	it("rejects mismatched 304s and applies new cache headers from matching 304s", () => {
		const entry = policy({ etag: '"origin-1"' });
		expect(
			entry.revalidate(url, headers, { status: 304, headers: new Headers({ etag: '"other"' }) }),
		).toBeUndefined();
		const updated = entry.revalidate(url, headers, {
			status: 304,
			headers: new Headers({ etag: '"origin-1"', "cache-control": "max-age=60", vary: "Accept" }),
		});
		expect(updated?.fresh(url, headers)).toBe(true);
		expect(HttpCachePolicy.restore(updated?.serialize() ?? null)?.fresh(url, headers)).toBe(true);
		expect(updated?.fresh(url, new Headers({ accept: "image/png" }))).toBe(false);
	});

	it("honors no-store, no-cache and wildcard Vary", () => {
		expect(policy({ "cache-control": "no-store, max-age=60" }).serialize()).toBeNull();
		expect(policy({ "cache-control": "max-age=60", vary: "*" }).serialize()).toBeNull();
		const entry = policy({ "cache-control": "no-cache, max-age=60", etag: '"v1"' });
		expect(entry.fresh(url, headers)).toBe(false);
		expect(entry.conditionalHeaders(url, headers).get("if-none-match")).toBe('"v1"');
	});

	it("permits stale only inside the server error window for the same representation", () => {
		vi.useFakeTimers();
		const entry = policy({ "cache-control": "max-age=1, stale-if-error=60", vary: "accept" });
		vi.advanceTimersByTime(2000);
		expect(entry.allowsStaleOnError(url, headers, 503)).toBe(true);
		expect(entry.allowsStaleOnError(`${url}x`, headers, 503)).toBe(false);
		expect(entry.allowsStaleOnError(url, new Headers({ accept: "image/png" }), 503)).toBe(false);
		expect(entry.allowsStaleOnError(url, headers, 404)).toBe(false);
		vi.advanceTimersByTime(60000);
		expect(entry.allowsStaleOnError(url, headers, 503)).toBe(false);
		for (const directive of ["must-revalidate", "no-cache", "no-store"]) {
			expect(
				policy({
					"cache-control": `max-age=0, stale-if-error=60, ${directive}`,
				}).allowsStaleOnError(url, headers, 500),
			).toBe(false);
		}
		expect(policy({ "cache-control": "max-age=60" }).allowsStaleOnError(url, headers, 500)).toBe(
			false,
		);
	});

	it("normalizes directive names, not quoted values, on responses and requests", () => {
		expect(policy({ "cache-control": "No-Store, Max-Age=60" }).serialize()).toBeNull();
		expect(policy({ "cache-control": "No-Cache, Max-Age=60" }).fresh(url, headers)).toBe(false);
		const entry = policy({ "cache-control": 'Private, Max-Age="60", Extension="KeepCase"' });
		expect(entry.fresh(url, headers)).toBe(true);
		expect(JSON.stringify(entry.serialize())).toContain("KeepCase");
		const requestHeaders = new Headers({ "cache-control": "No-Store" });
		expect(policy({ "cache-control": "Max-Age=60" }, requestHeaders).serialize()).toBeNull();
		const updated = entry.revalidate(url, headers, {
			status: 304,
			headers: new Headers({ "cache-control": "No-Store, Max-Age=60" }),
		});
		expect(updated?.serialize()).toBeNull();
	});

	it("does not infer freshness from directives inside quoted extension values", () => {
		expect(
			policy({ "cache-control": 'Extension="KeepCase, max-age=60"' }).fresh(url, headers),
		).toBe(false);
		expect(
			policy({ "cache-control": 'No-Cache="ETag, Content-Length", Max-Age=60' }).fresh(
				url,
				headers,
			),
		).toBe(false);
	});

	it.each([
		"stale-if-error",
		"stale-if-error=1.5",
		"stale-if-error=1e3",
		"stale-if-error=-1",
		"stale-if-error=9007199254740992",
		"stale-if-error, stale-if-error=60",
		"Stale-If-Error=0, STALE-IF-ERROR=60",
	])("rejects invalid server delta-seconds: %s", (directive) => {
		expect(
			policy({ "cache-control": `max-age=0, ${directive}` }).allowsStaleOnError(url, headers, 503),
		).toBe(false);
	});

	it.each([
		"max-age=0, max-age=3600",
		"max-age, max-age=3600",
		"Max-Age=0, MAX-AGE=3600",
		"max-age=3600garbage",
		"max-age=1.5",
		"max-age=1e3",
		"max-age=9007199254740992",
	])("rejects invalid or duplicate freshness: %s", (control) => {
		expect(policy({ "cache-control": control }).fresh(url, headers)).toBe(false);
	});

	it.each(["max-age=3600garbage", "Max-Age=0, MAX-AGE=3600"])(
		"rejects malformed request and 304 freshness: %s",
		(control) => {
			const requestHeaders = new Headers({ "cache-control": control });
			expect(
				policy({ "cache-control": "max-age=3600" }, requestHeaders).fresh(url, requestHeaders),
			).toBe(false);
			const entry = policy({ "cache-control": "max-age=0", etag: '"v1"' });
			const updated = entry.revalidate(url, headers, {
				status: 304,
				headers: new Headers({ "cache-control": control, etag: '"v1"' }),
			});
			expect(updated?.fresh(url, headers)).toBe(false);
		},
	);

	it("uses fresh must-revalidate bytes but still honors request and response no-cache", () => {
		const entry = policy({ "cache-control": "max-age=3600, must-revalidate" });
		expect(entry.fresh(url, headers)).toBe(true);
		const requestHeaders = new Headers({ "cache-control": "no-cache" });
		expect(
			policy({ "cache-control": "max-age=3600, must-revalidate" }, requestHeaders).fresh(
				url,
				requestHeaders,
			),
		).toBe(false);
		expect(
			policy({ "cache-control": "max-age=3600, must-revalidate, no-cache" }).fresh(url, headers),
		).toBe(false);
	});

	it("matches raw Cache-Control values before freshness, validators, 304 or stale fallback", () => {
		const first = new Headers({ "Cache-Control": 'Extension="a,b"' });
		const second = new Headers({ "cache-control": 'Extension="c,d"' });
		const entry = policy(
			{ "cache-control": "max-age=60", vary: "Cache-Control", etag: '"v1"' },
			first,
		);
		expect(entry.fresh(url, first)).toBe(true);
		expect(entry.fresh(url, new Headers({ "cache-control": 'Extension="a,b"' }))).toBe(true);
		expect(entry.fresh(url, second)).toBe(false);
		const restored = HttpCachePolicy.restore(entry.serialize());
		expect(restored?.fresh(url, first)).toBe(true);
		expect(restored?.fresh(url, second)).toBe(false);
		expect(restored?.conditionalHeaders(url, second).has("if-none-match")).toBe(false);
		expect(
			restored?.revalidate(url, second, { status: 304, headers: new Headers({ etag: '"v1"' }) }),
		).toBeUndefined();
		const stale = policy(
			{ "cache-control": "max-age=0, stale-if-error=60", vary: "Cache-Control" },
			first,
		);
		expect(stale.allowsStaleOnError(url, first, 503)).toBe(true);
		expect(stale.allowsStaleOnError(url, second, 503)).toBe(false);
	});

	it("rejects serialized policy without a raw request fingerprint", () => {
		const serialized = policy({ "cache-control": "max-age=60" }).serialize();
		if (!serialized || typeof serialized !== "object" || Array.isArray(serialized))
			throw new Error("Expected serialized policy");
		const legacy = { ...serialized };
		delete legacy.requestFingerprint;
		expect(HttpCachePolicy.restore(legacy)).toBeUndefined();
	});

	it("does not persist raw request credentials or unrelated response headers", () => {
		const entry = policy(
			{
				"cache-control": "max-age=60",
				vary: "Authorization, Cookie",
				"set-cookie": "response-secret",
			},
			new Headers({ authorization: "Bearer request-secret", cookie: "cookie-secret" }),
		);
		const serialized = JSON.stringify(entry.serialize());
		expect(serialized).not.toContain("request-secret");
		expect(serialized).not.toContain("cookie-secret");
		expect(serialized).not.toContain("response-secret");
		expect(HttpCachePolicy.restore(entry.serialize())).toBeDefined();
		expect(HttpCachePolicy.restore({ invalid: true })).toBeUndefined();
	});
});
