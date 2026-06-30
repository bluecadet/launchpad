import { createMockEventBus } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { WorkflowRunner } from "../workflow-runner.js";

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
