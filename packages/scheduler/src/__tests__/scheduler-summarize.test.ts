import { describe, expect, it } from "vitest";
import type { SchedulerState } from "../scheduler-state.js";
import { buildSchedulerSection } from "../scheduler-summarize.js";

process.env.TZ = "UTC";

const now = new Date("2026-01-01T12:00:00Z");

function makeState(jobs: SchedulerState["jobs"]): SchedulerState {
	return { jobs };
}

describe("buildSchedulerSection", () => {
	it("returns a Scheduler section with no rows when no jobs are configured", () => {
		expect(buildSchedulerSection(makeState({}), now)).toEqual({
			name: "scheduler",
			order: 30,
			title: "Scheduler",
			rows: [],
		});
	});

	it("shows an ok interval job after a successful run", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 0,
					lastOutcome: "success",
					lastErrorMessage: null,
					lastSuccessAt: new Date("2026-01-01T11:55:00Z"),
					nextFireAt: new Date("2026-01-01T12:04:00Z"),
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "every 5m · last ok 5m ago · next in 4m",
				tone: "ok",
			},
		]);
	});

	it("floors non-round relative times to a single coarse bucket", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 0,
					lastOutcome: "success",
					lastErrorMessage: null,
					// 5m30s ago, and next fire in 4m30s: neither divides evenly into a single
					// unit, so this exercises formatTimeAgo/formatTimeUntil's floor behavior
					// rather than the old divisibility-based rendering (which would have shown
					// "330s ago" / "in 270s").
					lastSuccessAt: new Date("2026-01-01T11:54:30Z"),
					nextFireAt: new Date("2026-01-01T12:04:30Z"),
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "every 5m · last ok 5m ago · next in 4m",
				tone: "ok",
			},
		]);
	});

	it("shows an ok first-run interval job", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 0,
					lastOutcome: null,
					lastErrorMessage: null,
					lastSuccessAt: null,
					nextFireAt: new Date("2026-01-01T12:04:00Z"),
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "every 5m · first run in 4m",
				tone: "ok",
			},
		]);
	});

	it("shows overlap skips honestly without treating them as failures", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 0,
					lastOutcome: "overlapSkip",
					lastErrorMessage: null,
					lastSuccessAt: null,
					nextFireAt: new Date("2026-01-01T12:04:00Z"),
					stoppedWithError: false,
					skippedOverlapCount: 2,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "every 5m · last run skipped (command busy) · next in 4m",
				tone: "ok",
			},
		]);
	});

	it("shows a mid-backoff failure as a warning", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 4,
					lastOutcome: "failure",
					lastErrorMessage: "Connection refused",
					lastSuccessAt: null,
					nextFireAt: new Date("2026-01-01T12:00:30Z"),
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "retrying (attempt 4) · next retry in 30s · last error: Connection refused",
				tone: "warn",
			},
		]);
	});

	it("shows a mid-run interval job with its honest run age", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 0,
					lastOutcome: "success",
					lastErrorMessage: null,
					lastSuccessAt: new Date("2026-01-01T08:00:00Z"),
					nextFireAt: null,
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: true,
					// Running for 3h12m — the previous success is superseded by the live run.
					runStartedAt: new Date("2026-01-01T08:48:00Z"),
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "every 5m · running · started 3h ago",
				tone: "warn",
			},
		]);
	});

	it("keeps a normal-length in-flight run at an ok tone", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 0,
					lastOutcome: null,
					lastErrorMessage: null,
					lastSuccessAt: null,
					nextFireAt: null,
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: true,
					runStartedAt: new Date("2026-01-01T11:59:30Z"), // 30s in flight
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "every 5m · running · started 30s ago",
				tone: "ok",
			},
		]);
	});

	it("shows opt-in retry exhaustion as an error", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 5,
					lastOutcome: "failure",
					lastErrorMessage: "Connection refused",
					lastSuccessAt: null,
					nextFireAt: null,
					stoppedWithError: true,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "gave up after 5 attempts · last error: Connection refused",
				tone: "error",
			},
		]);
	});

	it("shows paused jobs neutrally", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: true,
					schedule: { intervalMs: 300_000 },
					attemptCount: 0,
					lastOutcome: null,
					lastErrorMessage: null,
					lastSuccessAt: null,
					nextFireAt: null,
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{ type: "kv", label: "content.fetch", value: "paused", tone: "neutral" },
		]);
	});

	it("shows cron jobs with their absolute and relative next run", () => {
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { cron: "*/5 * * * *" },
					attemptCount: 0,
					lastOutcome: null,
					lastErrorMessage: null,
					lastSuccessAt: null,
					nextFireAt: new Date("2026-01-01T12:05:00Z"),
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		expect(section.rows).toEqual([
			{
				type: "kv",
				label: "content.fetch",
				value: "cron */5 * * * * · first run 12:05 (in 5m)",
				tone: "ok",
			},
		]);
	});

	it("keeps errors glanceable by retaining only the capped first line", () => {
		const error =
			"The fetch service rejected this request because the certificate chain is invalid after renewal\nfull diagnostic details";
		const section = buildSchedulerSection(
			makeState({
				"content.fetch": {
					paused: false,
					schedule: { intervalMs: 300_000 },
					attemptCount: 1,
					lastOutcome: "failure",
					lastErrorMessage: error,
					lastSuccessAt: null,
					nextFireAt: new Date("2026-01-01T12:00:30Z"),
					stoppedWithError: false,
					skippedOverlapCount: 0,
					isRunning: false,
					runStartedAt: null,
				},
			}),
			now,
		);

		const row = section.rows[0];
		if (row?.type !== "kv") throw new Error("Expected a scheduler row");
		expect(row.value).toBe(
			"retrying (attempt 1) · next retry in 30s · last error: The fetch service rejected this request because the certificate chain is inva...",
		);
	});
});
