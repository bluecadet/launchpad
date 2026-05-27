import { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { LogEntry } from "../core/log-entry.js";
import type { ObservabilityTransport } from "../core/transport.js";

// ─── Config Schema ─────────────────────────────────────────────────────────

const lokiAuthSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("basic"),
		username: z.string(),
		password: z.string(),
	}),
	z.object({
		type: z.literal("bearer"),
		token: z.string(),
	}),
]);

export const lokiTransportConfigSchema = z.object({
	/**
	 * Base URL of the Loki instance (e.g. "http://localhost:3100").
	 * The push endpoint /loki/api/v1/push is appended automatically.
	 */
	url: z.string(),
	/**
	 * Static labels applied to every log stream from this transport.
	 * Use these for high-level identifiers: app, env, location, etc.
	 */
	defaultLabels: z.record(z.string(), z.string()).default({}),
	/** Optional authentication configuration. */
	auth: lokiAuthSchema.optional(),
	/** Optional extra headers (e.g. for proxies or API gateways). */
	headers: z.record(z.string(), z.string()).optional(),
});

export type LokiTransportConfig = z.input<typeof lokiTransportConfigSchema>;
export type ResolvedLokiTransportConfig = z.output<typeof lokiTransportConfigSchema>;
export type LokiAuth = z.infer<typeof lokiAuthSchema>;

export type { ObservabilityTransport };

// ─── Loki payload helpers ───────────────────────────────────────────────────

type LokiStream = {
	stream: Record<string, string>;
	values: [string, string][];
};

type LokiPushPayload = {
	streams: LokiStream[];
};

/**
 * Converts a Date to a Loki nanosecond timestamp string.
 * Appends 6 zeros to the millisecond timestamp for nanosecond precision.
 */
function toNsTimestamp(date: Date): string {
	return `${date.getTime()}000000`;
}

function getStreamLabels(
	entry: LogEntry,
	defaultLabels: Record<string, string>,
): Record<string, string> {
	if (entry.level === "event") {
		return { ...defaultLabels, level: "event", event: entry.event };
	}
	const labels: Record<string, string> = {
		...defaultLabels,
		level: entry.level,
	};
	if (entry.module) labels.module = entry.module;
	return labels;
}

function labelsToKey(labels: Record<string, string>): string {
	return Object.entries(labels)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}=${v}`)
		.join(",");
}

function buildLokiPayload(
	batch: LogEntry[],
	defaultLabels: Record<string, string>,
): LokiPushPayload {
	const streamMap = new Map<string, LokiStream>();

	for (const entry of batch) {
		const labels = getStreamLabels(entry, defaultLabels);
		const key = labelsToKey(labels);

		if (!streamMap.has(key)) {
			streamMap.set(key, { stream: labels, values: [] });
		}

		streamMap.get(key)?.values.push([toNsTimestamp(entry.timestamp), entry.message]);
	}

	return { streams: Array.from(streamMap.values()) };
}

function buildAuthHeader(auth: LokiAuth): string {
	if (auth.type === "basic") {
		const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
		return `Basic ${credentials}`;
	}
	return `Bearer ${auth.token}`;
}

// ─── Transport factory ──────────────────────────────────────────────────────

/**
 * Creates a Loki transport that pushes log batches to Loki's HTTP push API.
 */
export function createLokiTransport(config: LokiTransportConfig): ObservabilityTransport {
	const resolved = lokiTransportConfigSchema.parse(config);
	const pushUrl = `${resolved.url.replace(/\/$/, "")}/loki/api/v1/push`;

	return {
		name: "loki",

		push(batch: LogEntry[]): ResultAsync<void, Error> {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...resolved.headers,
			};

			if (resolved.auth) {
				headers.Authorization = buildAuthHeader(resolved.auth);
			}

			const body = JSON.stringify(buildLokiPayload(batch, resolved.defaultLabels));

			return ResultAsync.fromPromise(
				fetch(pushUrl, { method: "POST", headers, body }).then(async (response) => {
					if (!response.ok) {
						const text = await response.text().catch(() => "");
						throw new Error(
							`Loki push failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
						);
					}
				}),
				(error) => (error instanceof Error ? error : new Error(String(error))),
			);
		},
	};
}
