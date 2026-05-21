import type { Section, StatusSnapshot } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";
import { describe, expect, it } from "vitest";
import { formatSnapshot } from "../format-snapshot.js";

function makeSnapshot(overrides?: Partial<StatusSnapshot>): StatusSnapshot {
	return {
		header: { startTime: new Date(0).toISOString(), uptimeMs: 0, mode: "task" },
		sections: [],
		...overrides,
	};
}

describe("formatSnapshot", () => {
	it("header always includes 'Launchpad Status:' in bold", () => {
		const output = formatSnapshot(makeSnapshot());
		expect(output).toContain(chalk.bold("Launchpad Status:"));
	});

	it("header includes uptime formatted from uptimeMs", () => {
		const output = formatSnapshot(
			makeSnapshot({
				header: { startTime: new Date(0).toISOString(), uptimeMs: 65_000, mode: "task" },
			}),
		);
		expect(output).toContain("Uptime: 1m 5s");
	});

	it("uptime: days shown when >= 1 day", () => {
		const ms = (1 * 86400 + 2 * 3600 + 3 * 60) * 1000;
		const output = formatSnapshot(
			makeSnapshot({
				header: { startTime: new Date(0).toISOString(), uptimeMs: ms, mode: "task" },
			}),
		);
		expect(output).toContain("Uptime: 1d 2h 3m");
	});

	it("uptime: hours shown when >= 1 hour", () => {
		const ms = (3 * 3600 + 12 * 60) * 1000;
		const output = formatSnapshot(
			makeSnapshot({
				header: { startTime: new Date(0).toISOString(), uptimeMs: ms, mode: "task" },
			}),
		);
		expect(output).toContain("Uptime: 3h 12m");
	});

	it("uptime: seconds only when < 1 minute", () => {
		const output = formatSnapshot(
			makeSnapshot({
				header: { startTime: new Date(0).toISOString(), uptimeMs: 42_000, mode: "task" },
			}),
		);
		expect(output).toContain("Uptime: 42s");
	});

	it("empty sections array — output has no section headings", () => {
		const output = formatSnapshot(makeSnapshot({ sections: [] }));
		// Only header lines present
		const lines = output.split("\n").filter((l) => l.trim().length > 0);
		expect(lines).toHaveLength(2); // "Launchpad Status:" and "  Uptime: …"
	});

	it("sections appear in array order", () => {
		const sections: Section[] = [
			{ name: "alpha", title: "Alpha", order: 10, rows: [] },
			{ name: "beta", title: "Beta", order: 20, rows: [] },
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output.indexOf("Alpha")).toBeLessThan(output.indexOf("Beta"));
	});

	it("kv row with tone ok — value is chalk.green", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [{ type: "kv", label: "Status", value: "Running", tone: "ok" }],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain(`Status: ${chalk.green("Running")}`);
	});

	it("kv row with tone warn — value is chalk.yellow", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [{ type: "kv", label: "Status", value: "Degraded", tone: "warn" }],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain(`Status: ${chalk.yellow("Degraded")}`);
	});

	it("kv row with tone error — value is chalk.red", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [{ type: "kv", label: "Status", value: "Failed", tone: "error" }],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain(`Status: ${chalk.red("Failed")}`);
	});

	it("kv row with tone neutral — value appears plainly without tone color prefix", () => {
		// Use chalk.level to verify: at level 0 everything is plain; at higher levels
		// we can confirm a neutral value does not appear wrapped in an error color.
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [
					{ type: "kv", label: "Mode", value: "task", tone: "neutral" },
					{ type: "kv", label: "Bad", value: "boom", tone: "error" },
				],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain("Mode: task");
		// The neutral value should appear, but its rendered form should differ from the error-toned value's form
		if (chalk.level > 0) {
			expect(output).not.toContain(chalk.red("task"));
			expect(output).toContain(chalk.red("boom"));
		}
	});

	it("kv row with no tone — value has no color wrapping", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [{ type: "kv", label: "Mode", value: "task" }],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain("Mode: task");
	});

	it("list row — label shown with items indented below", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [
					{
						type: "list",
						label: "Apps",
						items: [
							{ type: "kv", label: "app-a", value: "online", tone: "ok" },
							{ type: "kv", label: "app-b", value: "offline", tone: "error" },
						],
					},
				],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain("Apps:");
		expect(output).toContain(`${chalk.green("✓")} app-a: online`);
		expect(output).toContain(`${chalk.red("✗")} app-b: offline`);
	});

	it("list row — warn item gets yellow bullet icon", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [
					{
						type: "list",
						label: "Sources",
						items: [{ type: "kv", label: "src", value: "degraded", tone: "warn" }],
					},
				],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain(`${chalk.yellow("●")} src: degraded`);
	});

	it("list row — neutral/undefined item gets gray circle icon", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [
					{
						type: "list",
						label: "Sources",
						items: [{ type: "kv", label: "src", value: "pending" }],
					},
				],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain(`${chalk.gray("○")} src: pending`);
	});

	it("list row — kv item has icon and label:value, value is not separately color-wrapped", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [
					{
						type: "list",
						label: "Apps",
						items: [{ type: "kv", label: "app", value: "online", tone: "ok" }],
					},
				],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		// Icon present and label:value present
		expect(output).toContain(chalk.green("✓"));
		expect(output).toContain("app: online");
		// When chalk is active the icon is colored but the full "app: online" is not separately green-wrapped
		if (chalk.level > 0) {
			expect(output).not.toContain(chalk.green("app: online"));
		}
	});

	it("text row — text appears indented", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [{ type: "text", text: "Some info message" }],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain("  Some info message");
	});

	it("text row with tone error — text is chalk.red", () => {
		const sections: Section[] = [
			{
				name: "s",
				title: "Section",
				rows: [{ type: "text", text: "Something went wrong", tone: "error" }],
			},
		];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain(chalk.red("Something went wrong"));
	});

	it("section title is rendered in bold with colon", () => {
		const sections: Section[] = [{ name: "monitor", title: "Monitor", rows: [] }];
		const output = formatSnapshot(makeSnapshot({ sections }));
		expect(output).toContain(`${chalk.bold("Monitor")}:`);
	});
});
