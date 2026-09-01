/**
 * Token authentication and role authorization for the HTTP/SSE transport.
 *
 * Two rules hold this module together, and both are load-bearing:
 *
 * 1. Token *values* only ever come from the environment. Config names an
 *    environment variable; it never carries a secret.
 * 2. A token value never leaves this module. Errors, log lines, and the
 *    `AuthPrincipal` handed to the transport carry the operator-authored
 *    token *name* and role, never the value — so nothing downstream can
 *    put a secret into a log, into state, or onto the wire.
 *
 * Auth outcomes are deliberately not emitted on the event bus: bus events
 * are fanned out to every SSE client.
 */

import type http from "node:http";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { TransportError } from "../errors.js";
import { createPatternMatcher } from "./pattern-matcher.js";

const tokenDefinitionSchema = z.object({
	/**
	 * Name of the environment variable holding the token value. Token values are
	 * never written inline in config — put them in a `.env` file loaded with
	 * `launchpad --env`, or in the process environment.
	 */
	env: z.string().min(1),
	/** Token role granting this token its command allowlist. Must exist in `roles`. */
	role: z.string().min(1),
});

export const httpAuthOptionsSchema = z
	.object({
		/** Named tokens, keyed by a human-readable name used in logs and errors. */
		tokens: z.record(z.string(), tokenDefinitionSchema).default({}),
		/**
		 * Token role -> command allowlist. Entries are prefix globs: an entry
		 * ending in `*` matches every command id starting with the part before
		 * it; `*` alone matches every command; anything else is an exact match.
		 * An empty array is legal and means "no commands" — a read-only token.
		 */
		roles: z.record(z.string(), z.array(z.string())).default({}),
	})
	.superRefine((value, ctx) => {
		for (const [tokenName, token] of Object.entries(value.tokens)) {
			if (!(token.role in value.roles)) {
				ctx.addIssue({
					code: "custom",
					message: `Token "${tokenName}" references role "${token.role}", which is not defined in \`roles\`.`,
					path: ["tokens", tokenName, "role"],
				});
			}
		}
	})
	.default({ tokens: {}, roles: {} });

export type HttpAuthOptions = z.input<typeof httpAuthOptionsSchema>;

type ResolvedHttpAuthOptions = z.output<typeof httpAuthOptionsSchema>;

/**
 * Who a request is from. Carries no token value by design, so a principal is
 * safe to log, and safe to pass to code that logs.
 */
export type AuthPrincipal = {
	readonly tokenName: string;
	readonly role: string;
};

export type AuthOutcome =
	/** No tokens configured; the transport is open. */
	| { status: "anonymous" }
	| { status: "authenticated"; principal: AuthPrincipal }
	/** A token was required and was missing or unknown. */
	| { status: "unauthenticated" };

export type AuthRegistry = {
	/** `false` when no tokens are configured, i.e. the transport is unauthenticated. */
	readonly enabled: boolean;
	/** Names of the configured tokens, for operator-facing log lines. */
	readonly tokenNames: readonly string[];
	authenticate(req: http.IncomingMessage, url: URL, isEventStream: boolean): AuthOutcome;
	isCommandAllowed(principal: AuthPrincipal, commandType: string): boolean;
};

const OPEN_REGISTRY: AuthRegistry = {
	enabled: false,
	tokenNames: [],
	authenticate: () => ({ status: "anonymous" }),
	isCommandAllowed: () => true,
};

/**
 * Resolve config into a ready-to-use registry, reading token values out of
 * `env` once at setup time. Fails setup rather than starting half-configured:
 * a token whose environment variable is missing would otherwise look like a
 * working config that rejects every client.
 */
export function resolveAuthRegistry(
	options: ResolvedHttpAuthOptions,
	env: NodeJS.ProcessEnv,
): Result<AuthRegistry, TransportError> {
	const tokenEntries = Object.entries(options.tokens);
	if (tokenEntries.length === 0) {
		return OPEN_REGISTRY_RESULT;
	}

	const principalsByValue = new Map<string, AuthPrincipal>();
	for (const [tokenName, token] of tokenEntries) {
		const value = env[token.env];
		if (value === undefined || value === "") {
			return err(
				new TransportError(
					`HTTP transport token "${tokenName}" requires environment variable ${token.env}, which is unset`,
				),
			);
		}
		const existing = principalsByValue.get(value);
		if (existing !== undefined) {
			return err(
				new TransportError(
					`HTTP transport tokens "${existing.tokenName}" and "${tokenName}" resolve to the same value; their roles would be ambiguous`,
				),
			);
		}
		principalsByValue.set(value, { tokenName, role: token.role });
	}

	const matchersByRole = new Map<string, (commandType: string) => boolean>(
		Object.entries(options.roles).map(([role, patterns]) => [role, createPatternMatcher(patterns)]),
	);

	return ok({
		enabled: true,
		tokenNames: Object.keys(options.tokens),
		authenticate: (req, url, isEventStream) => {
			const presented = extractToken(req, url, isEventStream);
			const principal = presented === undefined ? undefined : principalsByValue.get(presented);
			return principal === undefined
				? { status: "unauthenticated" }
				: { status: "authenticated", principal };
		},
		// A missing role is unreachable (the schema requires every token's role to
		// exist) but fails closed anyway.
		isCommandAllowed: (principal, commandType) =>
			matchersByRole.get(principal.role)?.(commandType) ?? false,
	});
}

const OPEN_REGISTRY_RESULT: Result<AuthRegistry, TransportError> = ok(OPEN_REGISTRY);

/**
 * Pull the presented token off a request. `Authorization: Bearer <token>` works
 * everywhere; `?access_token=` is accepted only on `GET /events`, because
 * browser `EventSource` cannot set request headers. Restricting the query
 * param to the one route that needs it keeps tokens out of URLs elsewhere.
 */
function extractToken(
	req: http.IncomingMessage,
	url: URL,
	isEventStream: boolean,
): string | undefined {
	const header = req.headers.authorization;
	if (header !== undefined) {
		const separator = header.indexOf(" ");
		if (separator === -1) {
			return undefined;
		}
		if (header.slice(0, separator).toLowerCase() !== "bearer") {
			return undefined;
		}
		const value = header.slice(separator + 1).trim();
		return value === "" ? undefined : value;
	}
	if (!isEventStream) {
		return undefined;
	}
	return url.searchParams.get("access_token") ?? undefined;
}

const MAX_LOGGED_TARGET_LENGTH = 200;

/**
 * Render a request target for an error body or a log line with the query
 * string stripped, since `GET /events?access_token=` puts a secret there.
 * Anything that echoes a request URL must go through this.
 */
export function redactRequestTarget(rawUrl: string | undefined): string {
	if (rawUrl === undefined || rawUrl === "") {
		return "<unparseable>";
	}
	const queryStart = rawUrl.indexOf("?");
	const path = queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);
	const truncated =
		path.length > MAX_LOGGED_TARGET_LENGTH ? `${path.slice(0, MAX_LOGGED_TARGET_LENGTH)}…` : path;
	return queryStart === -1 ? truncated : `${truncated}?<redacted>`;
}

/** Hosts that are only reachable from this machine. */
export function isLoopbackHost(host: string): boolean {
	return host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);
}
