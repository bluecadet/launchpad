import { createMockEventBus } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowObserver } from "../workflow-runner.js";
import { WorkflowRunner } from "../workflow-runner.js";
import type { WorkflowRun, WorkflowSummary } from "../workflow-state.js";

/** Records every observer notification in emission order. */
function createRecordingObserver() {
	const summaries: WorkflowSummary[][] = [];
	const runs: WorkflowRun[] = [];
	const observer: WorkflowObserver = {
		workflowsChanged(next) {
			summaries.push([...next]);
		},
		runUpdated(run) {
			runs.push(run);
		},
	};
	return { observer, summaries, runs };
}

function createExecuteCommandMock(
	implementation?: (command: BaseCommand) => ResultAsync<unknown, Error>,
) {
	return vi.fn<(command: BaseCommand) => ResultAsync<unknown, Error>>(
		implementation ?? (() => okAsync(undefined)),
	);
}

describe("WorkflowRunner", () => {
	it("runs named workflow sequentially", async () => {
		const eventBus = createMockEventBus();
		const executeCommand = createExecuteCommandMock();
		const runner = new WorkflowRunner(eventBus, executeCommand);
		runner.setWorkflows({
			start: ["content.fetch", "monitor.connect", "monitor.start"],
		});

		const result = await runner.run("start");

		expect(result.isOk()).toBe(true);
		expect(executeCommand.mock.calls.map(([command]) => command)).toEqual([
			{ type: "content.fetch" },
			{ type: "monitor.connect" },
			{ type: "monitor.start" },
		]);
		expect(eventBus.getEventsOfType("workflow:start")).toEqual([{ name: "start", stepCount: 3 }]);
		expect(eventBus.getEventsOfType("workflow:success")).toEqual([{ name: "start", stepCount: 3 }]);
	});

	it("resolves string steps to command objects", async () => {
		const executeCommand = createExecuteCommandMock();
		const runner = new WorkflowRunner(createMockEventBus(), executeCommand);
		runner.setWorkflows({ start: ["content.fetch"] });

		await runner.run("start");

		expect(executeCommand).toHaveBeenCalledWith({ type: "content.fetch" });
	});

	it("passes object steps through unchanged", async () => {
		const executeCommand = createExecuteCommandMock();
		const runner = new WorkflowRunner(createMockEventBus(), executeCommand);
		const step = { type: "content.fetch", sources: ["news"] };
		runner.setWorkflows({ start: [step] });

		await runner.run("start");

		expect(executeCommand).toHaveBeenCalledWith(step);
	});

	it("treats missing workflow as a no-op", async () => {
		const executeCommand = createExecuteCommandMock();
		const runner = new WorkflowRunner(createMockEventBus(), executeCommand);

		const result = await runner.run("missing");

		expect(result.isOk()).toBe(true);
		expect(executeCommand).not.toHaveBeenCalled();
	});

	it("runs later steps after a non-fatal failure", async () => {
		const eventBus = createMockEventBus();
		const fetchError = new Error("fetch failed");
		const executeCommand = createExecuteCommandMock((command) => {
			if (command.type === "content.fetch") {
				return errAsync(fetchError);
			}
			return okAsync(undefined);
		});
		const runner = new WorkflowRunner(eventBus, executeCommand);
		runner.setWorkflows({
			start: ["content.fetch", "monitor.connect", "monitor.start"],
		});

		const result = await runner.run("start");

		expect(result.isErr()).toBe(true);
		expect(executeCommand.mock.calls.map(([command]) => command)).toEqual([
			{ type: "content.fetch" },
			{ type: "monitor.connect" },
			{ type: "monitor.start" },
		]);
		expect(eventBus.getEventsOfType("workflow:success")).toEqual([]);
		expect(eventBus.getEventsOfType("workflow:error")).toEqual([
			expect.objectContaining({ name: "start", stepCount: 3, error: fetchError }),
		]);
	});

	it("halts remaining steps when a stopOnError step fails", async () => {
		const eventBus = createMockEventBus();
		const executeCommand = createExecuteCommandMock((command) => {
			if (command.type === "monitor.connect") {
				return errAsync(new Error("connect failed"));
			}
			return okAsync(undefined);
		});
		const runner = new WorkflowRunner(eventBus, executeCommand);
		runner.setWorkflows({
			start: ["content.fetch", { step: "monitor.connect", stopOnError: true }, "monitor.start"],
		});

		const result = await runner.run("start");

		expect(result.isErr()).toBe(true);
		expect(executeCommand.mock.calls.map(([command]) => command)).toEqual([
			{ type: "content.fetch" },
			{ type: "monitor.connect" },
		]);
		expect(eventBus.getEventsOfType("workflow:error")).toEqual([
			expect.objectContaining({ name: "start", stepCount: 3, error: expect.any(Error) }),
		]);
	});

	it("aggregates multiple non-fatal failures", async () => {
		const eventBus = createMockEventBus();
		const executeCommand = createExecuteCommandMock((command) => {
			if (command.type === "monitor.connect" || command.type === "monitor.start") {
				return errAsync(new Error(`${command.type} failed`));
			}
			return okAsync(undefined);
		});
		const runner = new WorkflowRunner(eventBus, executeCommand);
		runner.setWorkflows({
			start: ["content.fetch", "monitor.connect", "monitor.start"],
		});

		const result = await runner.run("start");

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error).toBeInstanceOf(AggregateError);
		if (error instanceof AggregateError) {
			expect(error.errors).toHaveLength(2);
		}
	});

	it("resolves stopOnError step objects to their command", async () => {
		const executeCommand = createExecuteCommandMock();
		const runner = new WorkflowRunner(createMockEventBus(), executeCommand);
		runner.setWorkflows({ start: [{ step: "content.fetch", stopOnError: true }] });

		await runner.run("start");

		expect(executeCommand).toHaveBeenCalledWith({ type: "content.fetch" });
	});
});

describe("WorkflowRunner as a workflow host", () => {
	it("lists configured workflows with their step counts in config order", () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		runner.setWorkflows({
			start: ["content.fetch", "monitor.start"],
			stop: ["monitor.stop"],
		});

		expect(runner.list()).toEqual([
			{ name: "start", stepCount: 2 },
			{ name: "stop", stepCount: 1 },
		]);
	});

	it("reports an unknown or empty workflow as absent", () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		runner.setWorkflows({ start: ["content.fetch"], empty: [] });

		expect(runner.has("start")).toBe(true);
		expect(runner.has("empty")).toBe(false);
		expect(runner.has("missing")).toBe(false);
		expect(runner.list()).toEqual([{ name: "start", stepCount: 1 }]);
	});

	it("notifies observers when the configured set changes, until they unsubscribe", () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		const { observer, summaries } = createRecordingObserver();
		const unsubscribe = runner.subscribe(observer);

		runner.setWorkflows({ start: ["content.fetch"] });
		unsubscribe();
		runner.setWorkflows({ start: ["content.fetch", "monitor.start"] });

		expect(summaries).toEqual([[{ name: "start", stepCount: 1 }]]);
	});

	it("records a successful run one transition at a time", async () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		const { observer, runs } = createRecordingObserver();
		runner.subscribe(observer);
		runner.setWorkflows({ start: ["content.fetch", "monitor.start"] });

		await runner.run("start");

		expect(runs.map((run) => run.status)).toEqual(["running", "running", "running", "success"]);
		const final = runs.at(-1);
		expect(final).toMatchObject({ runId: 1, name: "start", stepCount: 2, error: null });
		expect(final?.steps).toEqual([
			{
				index: 0,
				command: "content.fetch",
				status: "success",
				durationMs: expect.any(Number),
				error: null,
			},
			{
				index: 1,
				command: "monitor.start",
				status: "success",
				durationMs: expect.any(Number),
				error: null,
			},
		]);
		expect(final?.finishedAt).toEqual(expect.any(String));
	});

	it("assigns each run a monotonic id", async () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		const { observer, runs } = createRecordingObserver();
		runner.subscribe(observer);
		runner.setWorkflows({ start: ["content.fetch"] });

		await runner.run("start");
		await runner.run("start");

		expect(runs.filter((run) => run.status !== "running").map((run) => run.runId)).toEqual([1, 2]);
	});

	it("records a non-fatal step failure and keeps recording later steps", async () => {
		const executeCommand = createExecuteCommandMock((command) =>
			command.type === "content.fetch" ? errAsync(new Error("fetch failed")) : okAsync(undefined),
		);
		const runner = new WorkflowRunner(createMockEventBus(), executeCommand);
		const { observer, runs } = createRecordingObserver();
		runner.subscribe(observer);
		runner.setWorkflows({ start: ["content.fetch", "monitor.start"] });

		await runner.run("start");

		const final = runs.at(-1);
		expect(final?.status).toBe("error");
		expect(final?.error).toBe("fetch failed");
		expect(final?.steps.map((step) => step.status)).toEqual(["error", "success"]);
		expect(final?.steps[0]?.error).toBe("fetch failed");
	});

	it("records steps a stopOnError failure never reached as skipped", async () => {
		const executeCommand = createExecuteCommandMock((command) =>
			command.type === "app.build" ? errAsync(new Error("build failed")) : okAsync(undefined),
		);
		const runner = new WorkflowRunner(createMockEventBus(), executeCommand);
		const { observer, runs } = createRecordingObserver();
		runner.subscribe(observer);
		runner.setWorkflows({
			deploy: [{ step: "app.build", stopOnError: true }, "app.publish", "app.notify"],
		});

		await runner.run("deploy");

		expect(runs.at(-1)?.steps).toEqual([
			{
				index: 0,
				command: "app.build",
				status: "error",
				durationMs: expect.any(Number),
				error: "build failed",
			},
			{ index: 1, command: "app.publish", status: "skipped", durationMs: 0, error: null },
			{ index: 2, command: "app.notify", status: "skipped", durationMs: 0, error: null },
		]);
	});

	it("records the inner command type of a stopOnError step", async () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		const { observer, runs } = createRecordingObserver();
		runner.subscribe(observer);
		runner.setWorkflows({ start: [{ step: { type: "content.fetch", sources: ["news"] } }] });

		await runner.run("start");

		expect(runs.at(-1)?.steps[0]?.command).toBe("content.fetch");
	});

	it("emits the finished record before run() settles", async () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		const log: string[] = [];
		runner.subscribe({
			workflowsChanged() {},
			runUpdated(run) {
				log.push(`run:${run.status}`);
			},
		});
		runner.setWorkflows({ start: ["content.fetch"] });

		await runner.run("start");
		log.push("settled");

		expect(log.at(-2)).toBe("run:success");
		expect(log.at(-1)).toBe("settled");
	});

	it("emits no record for an unknown workflow", async () => {
		const runner = new WorkflowRunner(createMockEventBus(), createExecuteCommandMock());
		const { observer, runs } = createRecordingObserver();
		runner.subscribe(observer);

		await runner.run("missing");

		expect(runs).toEqual([]);
	});

	it("rejects a second concurrent run of the same workflow", async () => {
		const releases: Array<() => void> = [];
		const executeCommand = createExecuteCommandMock(
			() =>
				ResultAsync.fromSafePromise(
					new Promise<void>((resolve) => {
						releases.push(resolve);
					}),
				) as ResultAsync<unknown, Error>,
		);
		const runner = new WorkflowRunner(createMockEventBus(), executeCommand);
		runner.setWorkflows({ start: ["content.fetch"] });

		const inFlight = runner.run("start");
		const rejected = await runner.run("start");

		expect(rejected.isErr()).toBe(true);
		expect(rejected._unsafeUnwrapErr().message).toContain("already running");

		releases[0]?.();
		expect((await inFlight).isOk()).toBe(true);

		// The name is runnable again once the first run settles.
		const second = runner.run("start");
		releases[1]?.();
		expect((await second).isOk()).toBe(true);
	});
});
