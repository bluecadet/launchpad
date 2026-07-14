type DurationUnit = "ms" | "s" | "m" | "h";

const UNIT_TO_MS: Record<DurationUnit, number> = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
};

const DURATION_PATTERN = /^(?<amount>\d+(?:\.\d+)?)(?<unit>ms|s|m|h)$/;

function isDurationUnit(value: string): value is DurationUnit {
	return value in UNIT_TO_MS;
}

/**
 * Parses a duration string ("500ms" | "30s" | "5m" | "2h") or a raw millisecond
 * number into a millisecond count. Returns `null` for anything unparseable,
 * negative, or non-finite.
 */
export function parseDuration(value: string | number): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) && value >= 0 ? value : null;
	}

	const match = DURATION_PATTERN.exec(value.trim());
	const amount = match?.groups?.amount;
	const unit = match?.groups?.unit;
	if (amount === undefined || unit === undefined || !isDurationUnit(unit)) {
		return null;
	}

	const ms = Number.parseFloat(amount) * UNIT_TO_MS[unit];
	return Number.isFinite(ms) ? ms : null;
}
