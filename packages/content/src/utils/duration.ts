import { z } from "zod";

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/;

const UNIT_TO_MS: Record<string, number> = {
	ms: 1,
	s: 1000,
	m: 60_000,
	h: 3_600_000,
};

export class DurationParseError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "DurationParseError";
	}
}

/**
 * Parses a duration shorthand string (e.g. `"500ms"`, `"30s"`, `"5m"`, `"2h"`) or a raw
 * millisecond number into milliseconds.
 */
export function parseDuration(value: string | number): number {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value < 0) {
			throw new DurationParseError(`Invalid duration: ${value}`);
		}
		return value;
	}

	const match = DURATION_PATTERN.exec(value.trim());
	if (!match) {
		throw new DurationParseError(`Invalid duration string: "${value}"`);
	}

	const [, amount, unit] = match;
	return Number(amount) * UNIT_TO_MS[unit];
}

/**
 * Zod schema that accepts a duration shorthand string or a raw millisecond number and
 * resolves to the parsed millisecond value.
 */
export const durationSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
	try {
		return parseDuration(value);
	} catch (e) {
		ctx.addIssue(e instanceof Error ? e.message : "Invalid duration");
		return z.NEVER;
	}
});

export type Duration = z.input<typeof durationSchema>;
