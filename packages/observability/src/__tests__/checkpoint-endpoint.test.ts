import { describe, expect, it } from "vitest";
import { normalizeCheckpointEndpoint } from "../core/checkpoint-endpoint.js";

describe("checkpoint endpoint normalization", () => {
	it.each([
		["https://collector.example", "https://collector.example/"],
		["https://collector.example///", "https://collector.example/"],
		["HTTPS://COLLECTOR.EXAMPLE:443/team///", "https://collector.example/team"],
		["http://COLLECTOR.EXAMPLE:80/team/", "http://collector.example/team"],
		["https://collector.example:8443/team/", "https://collector.example:8443/team"],
		[" https://collector.example/team/ ", "https://collector.example/team"],
		["https://collector.example/a/../team/", "https://collector.example/team"],
		["https://collector.example/team//logs///", "https://collector.example/team//logs"],
		["https://collector.example/team%2Flogs/", "https://collector.example/team%2Flogs"],
		["https://collector.example/?", "https://collector.example/?"],
		["https://collector.example/#", "https://collector.example/#"],
	])("normalizes %s without changing existing routing identity", (endpoint, expected) => {
		expect(normalizeCheckpointEndpoint(endpoint)).toBe(expected);
	});

	it.each([
		undefined,
		null,
		42,
		{},
		new URL("https://collector.example"),
		"",
		"not a URL",
		"/relative/path",
		"ftp://collector.example",
		"https://user@collector.example",
		"https://:password@collector.example",
		"https://user:password@collector.example",
		"https://collector.example/?tenant=secret",
		"https://collector.example/#secret",
	])("omits checkpoint identity for unsupported or secret-bearing input: %j", (endpoint) => {
		expect(normalizeCheckpointEndpoint(endpoint)).toBeUndefined();
	});

	it("keeps endpoint, account path, scheme, and port changes distinct", () => {
		const endpoints = [
			"https://collector.example/team-a",
			"https://collector.example/team-b",
			"https://other.example/team-a",
			"http://collector.example/team-a",
			"https://collector.example:8443/team-a",
		];
		const identities = endpoints.map(normalizeCheckpointEndpoint);
		expect(identities.every((identity) => identity !== undefined)).toBe(true);
		expect(new Set(identities).size).toBe(endpoints.length);
	});
});
