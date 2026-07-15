const DEFAULT_JITTER_RATIO = 0.1;

/**
 * Fleet-desync jitter for wall-clock cron jobs, in ms. Unlike interval jobs, a cron
 * gap can be many hours, so a percentage of it would shift the occurrence far from its
 * wall-clock time; `true` resolves to this fixed, sane cap instead.
 */
const CRON_DEFAULT_JITTER_MS = 60_000;

/**
 * Resolves a job's jitter config to a maximum jitter duration in ms.
 * `true` defaults to ~10% of the base delay it's applied against.
 */
export function resolveJitterMs(jitter: boolean | number, baseMs: number): number {
	if (jitter === false) return 0;
	if (jitter === true) return baseMs * DEFAULT_JITTER_RATIO;
	return jitter;
}

/**
 * Resolves a cron job's jitter config to a maximum jitter duration in ms. The `true`
 * default (including the config-wide default) caps at {@link CRON_DEFAULT_JITTER_MS}
 * rather than scaling with the gap to the next occurrence, so a wall-clock schedule
 * such as `"0 3 * * *"` never fires meaningfully late. Explicit durations and `false`
 * behave exactly as for interval jobs.
 */
export function resolveCronJitterMs(jitter: boolean | number): number {
	if (jitter === false) return 0;
	if (jitter === true) return CRON_DEFAULT_JITTER_MS;
	return jitter;
}

/** Rolls a random jitter contribution in [0, maxJitterMs). */
export function randomJitterMs(maxJitterMs: number): number {
	if (maxJitterMs <= 0) return 0;
	return Math.random() * maxJitterMs;
}
