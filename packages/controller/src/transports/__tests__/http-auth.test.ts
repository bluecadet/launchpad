import type http from "node:http";
import { describe, expect, it } from "vitest";
import {
	type AuthPrincipal,
	httpAuthOptionsSchema,
	isLoopbackHost,
	redactRequestTarget,
	resolveAuthRegistry,
} from "../http-auth.js";

const DOCENT_TOKEN = "docent-token-value-0123456789";
const KIOSK_TOKEN = "kiosk-token-value-0123456789";

const AUTH_OPTIONS = {
	roles: {
		docent: ["workflow.*", "monitor.*"],
		kiosk: ["session.current"],
		liveness: [],
	},
	tokens: {
		"docent-tablet": { env: "TEST_TOKEN_DOCENT", role: "docent" },
		"lobby-kiosk": { env: "TEST_TOKEN_KIOSK", role: "kiosk" },
	},
};

/** Parse through the schema so tests exercise the same shape the transport gets. */
function parseAuthOptions(options: unknown) {
	const parsed = httpAuthOptionsSchema.safeParse(options);
	if (!parsed.success) {
		throw new Error(`Auth options failed to parse: ${parsed.error.message}`);
	}
	return parsed.data;
}

function fakeRequest(headers: http.IncomingHttpHeaders = {}) {
	return { headers } as http.IncomingMessage;
}

function bearer(token: string) {
	return fakeRequest({ authorization: `Bearer ${token}` });
}

const NO_QUERY = new URL("http://local/command");

describe("resolveAuthRegistry", () => {
	it("leaves the transport open when no tokens are configured", () => {
		const registry = resolveAuthRegistry(parseAuthOptions({}), {})._unsafeUnwrap();

		expect(registry.enabled).toBe(false);
		expect(registry.authenticate(fakeRequest(), NO_QUERY, false)).toEqual({ status: "anonymous" });
		expect(registry.isCommandAllowed({ tokenName: "x", role: "y" }, "anything")).toBe(true);
	});

	it("resolves each token from the environment and maps it to its role", () => {
		const registry = resolveAuthRegistry(parseAuthOptions(AUTH_OPTIONS), {
			TEST_TOKEN_DOCENT: DOCENT_TOKEN,
			TEST_TOKEN_KIOSK: KIOSK_TOKEN,
		})._unsafeUnwrap();

		expect(registry.enabled).toBe(true);
		expect(registry.tokenNames).toEqual(["docent-tablet", "lobby-kiosk"]);
		expect(registry.authenticate(bearer(DOCENT_TOKEN), NO_QUERY, false)).toEqual({
			status: "authenticated",
			principal: { tokenName: "docent-tablet", role: "docent" },
		});
	});

	it("fails setup naming the token and variable, never a value, when the variable is unset", () => {
		const result = resolveAuthRegistry(parseAuthOptions(AUTH_OPTIONS), {
			TEST_TOKEN_KIOSK: KIOSK_TOKEN,
		});

		const message = result._unsafeUnwrapErr().message;
		expect(message).toContain("docent-tablet");
		expect(message).toContain("TEST_TOKEN_DOCENT");
		expect(message).not.toContain(KIOSK_TOKEN);
	});

	it("treats an empty environment variable as unset", () => {
		const result = resolveAuthRegistry(parseAuthOptions(AUTH_OPTIONS), {
			TEST_TOKEN_DOCENT: "",
			TEST_TOKEN_KIOSK: KIOSK_TOKEN,
		});

		expect(result.isErr()).toBe(true);
	});

	it("refuses two token names that resolve to the same value", () => {
		const result = resolveAuthRegistry(parseAuthOptions(AUTH_OPTIONS), {
			TEST_TOKEN_DOCENT: DOCENT_TOKEN,
			TEST_TOKEN_KIOSK: DOCENT_TOKEN,
		});

		const message = result._unsafeUnwrapErr().message;
		expect(message).toContain("docent-tablet");
		expect(message).toContain("lobby-kiosk");
		expect(message).not.toContain(DOCENT_TOKEN);
	});

	describe("with two tokens resolved", () => {
		function registry() {
			return resolveAuthRegistry(parseAuthOptions(AUTH_OPTIONS), {
				TEST_TOKEN_DOCENT: DOCENT_TOKEN,
				TEST_TOKEN_KIOSK: KIOSK_TOKEN,
			})._unsafeUnwrap();
		}

		const docent: AuthPrincipal = { tokenName: "docent-tablet", role: "docent" };
		const kiosk: AuthPrincipal = { tokenName: "lobby-kiosk", role: "kiosk" };

		it("authorizes commands by the token role's globs", () => {
			expect(registry().isCommandAllowed(docent, "workflow.run")).toBe(true);
			expect(registry().isCommandAllowed(docent, "session.current")).toBe(false);
			expect(registry().isCommandAllowed(kiosk, "session.current")).toBe(true);
			expect(registry().isCommandAllowed(kiosk, "workflow.run")).toBe(false);
		});

		it("permits no command for a role with an empty glob list", () => {
			expect(registry().isCommandAllowed({ tokenName: "probe", role: "liveness" }, "*")).toBe(
				false,
			);
		});

		it("rejects an unknown token value", () => {
			expect(registry().authenticate(bearer("not-a-token"), NO_QUERY, false)).toEqual({
				status: "unauthenticated",
			});
		});

		it("rejects a missing, unscheming, or non-Bearer Authorization header", () => {
			expect(registry().authenticate(fakeRequest(), NO_QUERY, false).status).toBe(
				"unauthenticated",
			);
			expect(
				registry().authenticate(fakeRequest({ authorization: DOCENT_TOKEN }), NO_QUERY, false)
					.status,
			).toBe("unauthenticated");
			expect(
				registry().authenticate(
					fakeRequest({ authorization: `Basic ${DOCENT_TOKEN}` }),
					NO_QUERY,
					false,
				).status,
			).toBe("unauthenticated");
		});

		it("accepts a lower-case bearer scheme", () => {
			expect(
				registry().authenticate(
					fakeRequest({ authorization: `bearer ${DOCENT_TOKEN}` }),
					NO_QUERY,
					false,
				).status,
			).toBe("authenticated");
		});

		it("accepts ?access_token only on the event stream", () => {
			const url = new URL(`http://local/events?access_token=${DOCENT_TOKEN}`);

			expect(registry().authenticate(fakeRequest(), url, true).status).toBe("authenticated");
			expect(registry().authenticate(fakeRequest(), url, false).status).toBe("unauthenticated");
		});
	});
});

describe("httpAuthOptionsSchema", () => {
	it("defaults to no tokens and no roles", () => {
		expect(httpAuthOptionsSchema.parse(undefined)).toEqual({ tokens: {}, roles: {} });
	});

	it("rejects a token referencing a role that is not defined", () => {
		const parsed = httpAuthOptionsSchema.safeParse({
			roles: { kiosk: [] },
			tokens: { tablet: { env: "TEST_TOKEN_DOCENT", role: "docent" } },
		});

		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues[0]?.path).toEqual(["tokens", "tablet", "role"]);
	});

	it("accepts a role with an empty command list", () => {
		expect(
			httpAuthOptionsSchema.safeParse({
				roles: { liveness: [] },
				tokens: { probe: { env: "TEST_TOKEN_DOCENT", role: "liveness" } },
			}).success,
		).toBe(true);
	});

	it("has no inline value field: a literal token in config is dropped", () => {
		const parsed = parseAuthOptions({
			roles: { kiosk: [] },
			tokens: { tablet: { env: "TEST_TOKEN_KIOSK", role: "kiosk", value: KIOSK_TOKEN } },
		});

		expect(JSON.stringify(parsed)).not.toContain(KIOSK_TOKEN);
	});
});

describe("redactRequestTarget", () => {
	it("strips the query string, where the token lives", () => {
		const redacted = redactRequestTarget(`/events?access_token=${DOCENT_TOKEN}`);

		expect(redacted).toContain("/events");
		expect(redacted).toContain("<redacted>");
		expect(redacted).not.toContain(DOCENT_TOKEN);
	});

	it("leaves a query-less target alone", () => {
		expect(redactRequestTarget("/status")).toBe("/status");
	});

	it("reports an absent target as unparseable", () => {
		expect(redactRequestTarget(undefined)).toBe("<unparseable>");
		expect(redactRequestTarget("")).toBe("<unparseable>");
	});

	it("truncates an over-long target", () => {
		expect(redactRequestTarget(`/${"a".repeat(500)}`).length).toBeLessThan(250);
	});
});

describe("isLoopbackHost", () => {
	it.each(["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"])(
		"treats %s as loopback",
		(host) => {
			expect(isLoopbackHost(host)).toBe(true);
		},
	);

	it.each(["0.0.0.0", "192.168.1.10", "::", "exhibit.local"])("treats %s as reachable", (host) => {
		expect(isLoopbackHost(host)).toBe(false);
	});
});
