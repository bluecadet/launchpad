/**
 * A single gauge observation collected from a plugin's current state.
 *
 * Observations should contain only safe, bounded facts. Do not expose arbitrary
 * plugin state as metric attributes.
 */
export interface MetricObservation {
	readonly name: string;
	readonly value: number;
	readonly unit?: string;
	readonly description?: string;
	readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}
