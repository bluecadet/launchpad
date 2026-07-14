const DEFAULT_JITTER_RATIO = 0.1;

/**
 * Resolves a job's jitter config to a maximum jitter duration in ms.
 * `true` defaults to ~10% of the base delay it's applied against.
 */
export function resolveJitterMs(jitter: boolean | number, baseMs: number): number {
	if (jitter === false) return 0;
	if (jitter === true) return baseMs * DEFAULT_JITTER_RATIO;
	return jitter;
}

/** Rolls a random jitter contribution in [0, maxJitterMs). */
export function randomJitterMs(maxJitterMs: number): number {
	if (maxJitterMs <= 0) return 0;
	return Math.random() * maxJitterMs;
}
