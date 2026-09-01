import { describe, expect, it } from "vitest";
import { WorkflowRunRecorder } from "../workflow-run-record.js";

/** Deterministic clock: each read advances by one millisecond. */
function createClock(startMs = 1_000) {
	let current = startMs;
	return () => {
		const value = current;
		current += 1;
		return value;
	};
}

describe("WorkflowRunRecorder", () => {
	it("starts a run with no steps and no outcome", () => {
		const recorder = new WorkflowRunRecorder(1, "tour-mode", 3, () => 0);

		const run = recorder.start();

		expect(run).toEqual({
			runId: 1,
			name: "tour-mode",
			status: "running",
			startedAt: "1970-01-01T00:00:00.000Z",
			finishedAt: null,
			durationMs: null,
			stepCount: 3,
			steps: [],
			error: null,
		});
	});

	it("returns a fresh record from every transition", () => {
		const recorder = new WorkflowRunRecorder(1, "tour-mode", 2, createClock());
		const started = recorder.start();

		const afterStep = recorder.stepFinished(0, "monitor.start", 0, null);

		expect(started.steps).toEqual([]);
		expect(afterStep).not.toBe(started);
		expect(afterStep.steps).not.toBe(started.steps);
		expect(afterStep.steps).toHaveLength(1);
	});

	// Records are handed to an Immer producer, which freezes them; a recorder
	// that mutated an already-emitted record would throw on the next write.
	it("does not mutate a record after handing it out, even when frozen", () => {
		const recorder = new WorkflowRunRecorder(1, "tour-mode", 2, createClock());
		const started = Object.freeze(recorder.start());
		Object.freeze(started.steps);

		expect(() => recorder.stepFinished(0, "monitor.start", 0, null)).not.toThrow();
		expect(started.steps).toHaveLength(0);
	});

	it("records a step failure as its message only", () => {
		const recorder = new WorkflowRunRecorder(1, "tour-mode", 1, createClock());
		recorder.start();

		const run = recorder.stepFinished(
			0,
			"monitor.start",
			0,
			new Error("ENOENT", { cause: new Error("secret detail") }),
		);

		expect(run.steps[0]).toMatchObject({
			index: 0,
			command: "monitor.start",
			status: "error",
			error: "ENOENT",
		});
		expect(JSON.stringify(run)).not.toContain("secret detail");
	});

	it("measures a step's duration from the caller's start time", () => {
		let now = 100;
		const recorder = new WorkflowRunRecorder(1, "tour-mode", 1, () => now);
		recorder.start();
		now = 350;

		const run = recorder.stepFinished(0, "monitor.start", 100, null);

		expect(run.steps[0]?.durationMs).toBe(250);
	});

	it("fills unattempted steps in as skipped", () => {
		const recorder = new WorkflowRunRecorder(1, "deploy", 3, createClock());
		recorder.start();
		recorder.stepFinished(0, "build", 0, new Error("boom"));

		const run = recorder.finish(
			[
				{ index: 1, command: "publish" },
				{ index: 2, command: "notify" },
			],
			new Error("boom"),
		);

		expect(
			run.steps.map((step) => [step.index, step.command, step.status, step.durationMs]),
		).toEqual([
			[0, "build", "error", expect.any(Number)],
			[1, "publish", "skipped", 0],
			[2, "notify", "skipped", 0],
		]);
	});

	it("finishes with an aggregated error message and a duration", () => {
		let now = 0;
		const recorder = new WorkflowRunRecorder(7, "tour-mode", 1, () => now);
		recorder.start();
		now = 5_000;

		const run = recorder.finish([], new Error("two step failures"));

		expect(run.status).toBe("error");
		expect(run.error).toBe("two step failures");
		expect(run.durationMs).toBe(5_000);
		expect(run.finishedAt).toBe("1970-01-01T00:00:05.000Z");
	});

	it("finishes clean when nothing failed", () => {
		const recorder = new WorkflowRunRecorder(2, "tour-mode", 1, createClock());
		recorder.start();
		recorder.stepFinished(0, "monitor.start", 0, null);

		const run = recorder.finish([], null);

		expect(run.status).toBe("success");
		expect(run.error).toBeNull();
	});
});
