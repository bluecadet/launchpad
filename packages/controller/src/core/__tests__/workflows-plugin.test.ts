import {
	createMockEventBus,
	createMockPluginCtx,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import type {
	BaseCommand,
	InstantiatedPlugin,
	PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowListResult } from "../workflow-commands.js";
import type { WorkflowHost, WorkflowObserver } from "../workflow-runner.js";
import { WorkflowRunner } from "../workflow-runner.js";
import type { WorkflowRun, WorkflowSummary, WorkflowsState } from "../workflow-state.js";
import { createWorkflowsPlugin } from "../workflows-plugin.js";

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
	return {
		runId: 1,
		name: "tour-mode",
		status: "success",
		startedAt: "2026-01-01T00:00:00.000Z",
		finishedAt: "2026-01-01T00:00:01.000Z",
		durationMs: 1000,
		stepCount: 2,
		steps: [
			{ index: 0, command: "content.fetch", status: "success", durationMs: 10, error: null },
			{ index: 1, command: "monitor.start", status: "success", durationMs: 20, error: null },
		],
		error: null,
		...overrides,
	};
}

/** A `WorkflowHost` whose runs are driven by the test. */
function createFakeHost(summaries: WorkflowSummary[] = [{ name: "tour-mode", stepCount: 2 }]) {
	const observers: WorkflowObserver[] = [];
	let unsubscribeCalls = 0;
	let runImplementation: (name: string) => ResultAsync<void, Error> = () => okAsync(undefined);

	const host: WorkflowHost = {
		list: () => summaries.map((summary) => ({ ...summary })),
		has: (name) => summaries.some((summary) => summary.name === name),
		run: vi.fn((name: string) => runImplementation(name)),
		subscribe(observer) {
			observers.push(observer);
			return () => {
				unsubscribeCalls += 1;
				observers.splice(observers.indexOf(observer), 1);
			};
		},
	};

	return {
		host,
		unsubscribeCalls: () => unsubscribeCalls,
		setRun(implementation: (name: string) => ResultAsync<void, Error>) {
			runImplementation = implementation;
		},
		emitWorkflowsChanged(next: WorkflowSummary[]) {
			for (const observer of observers) observer.workflowsChanged(next);
		},
		emitRunUpdated(run: WorkflowRun) {
			for (const observer of observers) observer.runUpdated(run);
		},
	};
}

/** Mock ctx whose `updateState` applies producers to a real slice. */
function createStatefulCtx() {
	let slice: WorkflowsState = { available: [], runs: {} };
	const ctx = createMockPluginCtx("/", {
		updateState: vi.fn((producer: (draft: WorkflowsState) => WorkflowsState | void) => {
			slice = producer(slice) ?? slice;
		}) as unknown as PluginContext["updateState"],
	});
	return { ctx, getSlice: () => slice };
}

async function setupPlugin(host: WorkflowHost, ctx: ReturnType<typeof createStatefulCtx>["ctx"]) {
	const result = await createWorkflowsPlugin(host).setup(
		ctx as unknown as PluginContext<WorkflowsState>,
	);
	if (result.isErr()) throw result.error;
	return result.value as InstantiatedPlugin;
}

describe("workflows plugin", () => {
	it("seeds the state slice from the host at setup", async () => {
		const fake = createFakeHost([{ name: "tour-mode", stepCount: 2 }]);
		const { ctx, getSlice } = createStatefulCtx();

		await setupPlugin(fake.host, ctx);

		expect(getSlice()).toEqual({ available: [{ name: "tour-mode", stepCount: 2 }], runs: {} });
	});

	it("rewrites available workflows when the host's set changes", async () => {
		const fake = createFakeHost([]);
		const { ctx, getSlice } = createStatefulCtx();
		await setupPlugin(fake.host, ctx);

		fake.emitWorkflowsChanged([
			{ name: "start", stepCount: 1 },
			{ name: "stop", stepCount: 2 },
		]);

		expect(getSlice().available).toEqual([
			{ name: "start", stepCount: 1 },
			{ name: "stop", stepCount: 2 },
		]);
	});

	it("writes each run update into runs[name]", async () => {
		const fake = createFakeHost();
		const { ctx, getSlice } = createStatefulCtx();
		await setupPlugin(fake.host, ctx);

		fake.emitRunUpdated(makeRun({ status: "running", finishedAt: null, steps: [] }));
		fake.emitRunUpdated(makeRun());

		expect(getSlice().runs["tour-mode"]).toEqual(makeRun());
	});

	it("stops writing state after disconnect", async () => {
		const fake = createFakeHost();
		const { ctx, getSlice } = createStatefulCtx();
		const plugin = await setupPlugin(fake.host, ctx);

		await plugin.disconnect?.({ type: "manual" });
		fake.emitRunUpdated(makeRun());

		expect(fake.unsubscribeCalls()).toBe(1);
		expect(getSlice().runs).toEqual({});
	});

	describe("workflow.run", () => {
		it("resolves with the recorded run", async () => {
			const fake = createFakeHost();
			const { ctx } = createStatefulCtx();
			fake.setRun(() => {
				fake.emitRunUpdated(makeRun());
				return okAsync(undefined);
			});
			const plugin = await setupPlugin(fake.host, ctx);

			const result = await plugin.executeCommand?.({ type: "workflow.run", name: "tour-mode" });

			expect(result?.isOk()).toBe(true);
			expect(result?._unsafeUnwrap()).toEqual(makeRun());
		});

		it("rejects an unknown name without asking the host to run it", async () => {
			const fake = createFakeHost();
			const { ctx } = createStatefulCtx();
			const plugin = await setupPlugin(fake.host, ctx);

			const result = await plugin.executeCommand?.({ type: "workflow.run", name: "nope" });

			expect(result?.isErr()).toBe(true);
			expect(result?._unsafeUnwrapErr().message).toBe("Unknown workflow 'nope'");
			expect(fake.host.run).not.toHaveBeenCalled();
		});

		it("errs with the failing step named", async () => {
			const fake = createFakeHost();
			const { ctx } = createStatefulCtx();
			fake.setRun(() => {
				fake.emitRunUpdated(
					makeRun({
						status: "error",
						error: "ENOENT",
						steps: [
							{
								index: 0,
								command: "content.fetch",
								status: "success",
								durationMs: 1,
								error: null,
							},
							{
								index: 1,
								command: "monitor.start",
								status: "error",
								durationMs: 2,
								error: "ENOENT",
							},
						],
					}),
				);
				return errAsync(new Error("ENOENT"));
			});
			const plugin = await setupPlugin(fake.host, ctx);

			const result = await plugin.executeCommand?.({ type: "workflow.run", name: "tour-mode" });

			expect(result?.isErr()).toBe(true);
			expect(result?._unsafeUnwrapErr().message).toBe(
				"Workflow 'tour-mode' failed: step 2 (monitor.start): ENOENT",
			);
		});

		// Driven by the real runner: the misreport this guards against depends on
		// the in-flight record the runner writes while a run is still going.
		it("reports a rejected concurrent run as its own error", async () => {
			const releaseSlowStep: Array<() => void> = [];
			const executeCommand = (command: BaseCommand): ResultAsync<unknown, Error> =>
				command.type === "fails.step"
					? errAsync(new Error("ENOENT"))
					: ResultAsync.fromSafePromise<unknown, Error>(
							new Promise((resolve) => releaseSlowStep.push(() => resolve(undefined))),
						);
			const runner = new WorkflowRunner(createMockEventBus(), executeCommand);
			runner.setWorkflows({ "tour-mode": ["fails.step", "slow.step"] });
			const { ctx, getSlice } = createStatefulCtx();
			const plugin = await setupPlugin(runner, ctx);

			const inFlight = plugin.executeCommand?.({ type: "workflow.run", name: "tour-mode" });
			// Wait until the in-flight run has a failed step on record — that record
			// is what the second command must not be described with.
			await vi.waitFor(() => expect(getSlice().runs["tour-mode"]?.steps).toHaveLength(1));

			const rejected = await plugin.executeCommand?.({ type: "workflow.run", name: "tour-mode" });

			expect(rejected?.isErr()).toBe(true);
			expect(rejected?._unsafeUnwrapErr().message).toBe("Workflow 'tour-mode' is already running");

			releaseSlowStep[0]?.();
			const finished = await inFlight;
			expect(finished?._unsafeUnwrapErr().message).toBe(
				"Workflow 'tour-mode' failed: step 1 (fails.step): ENOENT",
			);
		});
	});

	describe("workflow.list", () => {
		it("reports every workflow with a null lastRun before anything runs", async () => {
			const fake = createFakeHost([
				{ name: "start", stepCount: 1 },
				{ name: "tour-mode", stepCount: 2 },
			]);
			const { ctx } = createStatefulCtx();
			const plugin = await setupPlugin(fake.host, ctx);

			const result = await plugin.executeCommand?.({ type: "workflow.list" });

			expect(result?._unsafeUnwrap()).toEqual({
				workflows: [
					{ name: "start", stepCount: 1, lastRun: null },
					{ name: "tour-mode", stepCount: 2, lastRun: null },
				],
			} satisfies WorkflowListResult);
		});

		it("carries the latest run once one exists", async () => {
			const fake = createFakeHost();
			const { ctx } = createStatefulCtx();
			const plugin = await setupPlugin(fake.host, ctx);
			fake.emitRunUpdated(makeRun());

			const result = await plugin.executeCommand?.({ type: "workflow.list" });

			expect(result?._unsafeUnwrap()).toEqual({
				workflows: [{ name: "tour-mode", stepCount: 2, lastRun: makeRun() }],
			} satisfies WorkflowListResult);
		});
	});

	describe("command parsers", () => {
		const parsers = Object.fromEntries(
			(createWorkflowsPlugin(createFakeHost().host).manifest?.commands ?? []).map((descriptor) => [
				descriptor.id,
				descriptor.parser,
			]),
		);

		it("rejects workflow.run without a usable name", () => {
			const parser = parsers["workflow.run"];
			expect(parser?.safeParse({ type: "workflow.run" }).success).toBe(false);
			expect(parser?.safeParse({ type: "workflow.run", name: "" }).success).toBe(false);
			expect(parser?.safeParse({ type: "workflow.run", name: 7 }).success).toBe(false);
		});

		it("strips extra fields rather than rejecting them", () => {
			const parsed = parsers["workflow.run"]?.safeParse({
				type: "workflow.run",
				name: "tour-mode",
				token: "should-not-survive",
			});

			expect(parsed?.success).toBe(true);
			expect(parsed?.success && parsed.data).toEqual({ type: "workflow.run", name: "tour-mode" });
		});
	});

	describe("summarize", () => {
		function summarize(state: WorkflowsState) {
			return createWorkflowsPlugin(createFakeHost().host).summarize?.({
				system: {},
				plugins: { workflows: state },
			} as unknown as LaunchpadState);
		}

		it("returns null when nothing is configured", () => {
			expect(summarize({ available: [], runs: {} })).toBeNull();
		});

		it("renders a row per run state", () => {
			const section = summarize({
				available: [
					{ name: "never", stepCount: 4 },
					{ name: "live", stepCount: 4 },
					{ name: "good", stepCount: 4 },
					{ name: "bad", stepCount: 4 },
				],
				runs: {
					live: makeRun({
						name: "live",
						status: "running",
						stepCount: 4,
						finishedAt: null,
						steps: [
							{ index: 0, command: "content.fetch", status: "success", durationMs: 1, error: null },
						],
					}),
					good: makeRun({ name: "good", stepCount: 4 }),
					bad: makeRun({
						name: "bad",
						status: "error",
						stepCount: 4,
						error: "ENOENT",
						steps: [
							{ index: 0, command: "content.fetch", status: "success", durationMs: 1, error: null },
							{
								index: 1,
								command: "monitor.start",
								status: "error",
								durationMs: 2,
								error: "ENOENT",
							},
						],
					}),
				},
			});

			expect(section).toMatchObject({ name: "workflows", title: "Workflows", order: 40 });
			expect(section?.rows).toEqual([
				{ type: "kv", label: "never", value: "never run · 4 steps", tone: "neutral" },
				{ type: "kv", label: "live", value: "running · step 2 of 4", tone: "neutral" },
				{ type: "kv", label: "good", value: "ok · 4 steps", tone: "ok" },
				{
					type: "kv",
					label: "bad",
					value: "failed · step 2 (monitor.start): ENOENT",
					tone: "error",
				},
			]);
		});
	});
});
