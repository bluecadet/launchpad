import { describe, expect, it } from "vitest";
import { type ConfigReferenceRow, getConfigReferenceRows } from "../config-reference.js";
import { configReferences } from "../config-references.js";

function referenceRows(id: string): ConfigReferenceRow[] {
	const reference = configReferences.find((entry) => entry.id === id);
	if (!reference) throw new Error(`Missing config reference: ${id}`);
	return getConfigReferenceRows(reference.schema, { nested: reference.nested });
}

function referenceRow(id: string, name: string): ConfigReferenceRow {
	const row = referenceRows(id).find((entry) => entry.name === name);
	if (!row) throw new Error(`Missing config reference row: ${id}.${name}`);
	return row;
}

describe("runtime configuration references", () => {
	it("registers the migrated sections exactly once", () => {
		expect(configReferences.map((entry) => entry.id)).toEqual([
			"content-options",
			"monitor-options",
			"scheduler-options",
			"observability-destination-options",
			"observability-legacy-options",
			"controller-logging-options",
			"controller-options",
			"launchpad-options",
		]);
	});

	it.each(configReferences)("describes $id from its real schema", (reference) => {
		const rows = getConfigReferenceRows(reference.schema, { nested: reference.nested });
		expect(rows.length).toBeGreaterThan(0);
		if (reference.id === "scheduler-options") {
			expect(rows[0]).toMatchObject({ name: "(root)", type: "ScheduleSpec" });
		} else {
			expect(rows.map((entry) => entry.name)).not.toContain("(root)");
		}
		for (const row of rows) {
			expect(row.type).not.toContain("set configDocs");
			expect(row.defaultValue ?? "").not.toContain("set configDocs");
		}
	});

	it("documents opaque public capabilities without replacing ordinary schema types", () => {
		const contentTypes = referenceRows("content-options").map((entry) => entry.type);
		expect(contentTypes).toContain("ContentTransform[]");
		expect(contentTypes).toContain('ContentSource["fetch"]');
		expect(referenceRows("content-options").map((entry) => entry.defaultValue)).toContain(
			'".downloads/"',
		);
		expect(referenceRow("monitor-options", "apps[].pm2").type).toBe("StartOptions & object");
		expect(referenceRows("scheduler-options").map((entry) => entry.type)).toContain("BaseCommand");
		expect(referenceRows("observability-destination-options").map((entry) => entry.type)).toContain(
			"readonly ObservabilityDestination[]",
		);
		expect(referenceRows("observability-legacy-options").map((entry) => entry.type)).toContain(
			"ObservabilityTransport[]",
		);
	});

	it("traverses downstream preprocess and resource pipe fields", () => {
		const schedulerNames = referenceRows("scheduler-options").map((entry) => entry.name);
		expect(schedulerNames).toContain("interval");
		expect(schedulerNames).toContain("retry.backoff.initial");
		expect(referenceRow("scheduler-options", "interval").description).toContain(
			"Required when cron is absent",
		);
		const observabilityNames = referenceRows("observability-destination-options").map(
			(entry) => entry.name,
		);
		expect(observabilityNames).toContain("resource[key]");
		expect(observabilityNames).toContain("delivery.deliveryTimeoutMs");
	});

	it("keeps contextual and nonserializable defaults stable", () => {
		const defaults = referenceRows("controller-logging-options").map((entry) => entry.defaultValue);
		expect(defaults).toContain("Built-in text format");
		expect(defaults).toContain("true outside tests; false when NODE_ENV is test");
		expect(defaults).toContain('"8m"');
	});

	it("limits host references to top-level fields", () => {
		const controller = referenceRows("controller-options").map((entry) => entry.name);
		expect(controller).toContain("logging");
		expect(controller).not.toContain("logging.dirname");
		const launchpad = referenceRows("launchpad-options").map((entry) => entry.name);
		expect(launchpad).toContain("plugins");
		expect(launchpad).not.toContain("controller.logging");
	});
});
