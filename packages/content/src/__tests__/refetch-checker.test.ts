import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { vol } from "memfs";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManifestReadCommandResult } from "../content-commands.js";
import type { Manifest } from "../manifest.js";
import { type RefetchCheckCommand, refetchChecker } from "../refetch-checker.js";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const OLDER = "2025-12-31T00:00:00.000Z";
const NEWER = "2026-01-02T00:00:00.000Z";

const manifest: Manifest = {
	schemaVersion: 1,
	versionId: "20260101T000000Z",
	versionPath: "versions/20260101T000000Z",
	generatedAt: GENERATED_AT,
	sources: [{ sourceId: "test", path: "test" }],
};

function createCtx(manifestResult: ManifestReadCommandResult = { status: "ok", manifest }) {
	const ctx = createMockPluginCtx();
	ctx.dispatchCommand.mockImplementation((command: BaseCommand) =>
		command.type === "content.manifest.read" ? okAsync(manifestResult) : okAsync(undefined),
	);
	return ctx;
}

function dispatchesOf(ctx: ReturnType<typeof createCtx>, type: string) {
	return ctx.dispatchCommand.mock.calls.filter(([command]) => command.type === type);
}

async function setupChecker(
	getLatestModifiedAt: () => Promise<string>,
	ctx: ReturnType<typeof createCtx>,
	downloadPath?: string,
) {
	const factory = refetchChecker({ getLatestModifiedAt, downloadPath });
	const result = await factory.setup(ctx);
	return result._unsafeUnwrap();
}

describe("refetchChecker", () => {
	afterEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	it("registers the refetch.check command in the plugin manifest", () => {
		const plugin = refetchChecker({ getLatestModifiedAt: async () => NEWER });
		expect(plugin.manifest?.commands?.map((command) => command.id)).toEqual(["refetch.check"]);
	});

	it("fetches when the CMS reports a value newer than the manifest baseline", async () => {
		const ctx = createCtx();
		const instance = await setupChecker(async () => NEWER, ctx);

		const result = await instance.executeCommand({ type: "refetch.check" });

		expect(result).toBeOk();
		expect(result._unsafeUnwrap()).toEqual({ modifiedAt: NEWER, fetched: true });
		expect(dispatchesOf(ctx, "content.fetch")).toHaveLength(1);
	});

	it("skips the fetch when the CMS value is not newer than the manifest baseline", async () => {
		const ctx = createCtx();
		const instance = await setupChecker(async () => OLDER, ctx);

		const result = await instance.executeCommand({ type: "refetch.check" });

		expect(result._unsafeUnwrap()).toEqual({ modifiedAt: OLDER, fetched: false });
		expect(dispatchesOf(ctx, "content.fetch")).toHaveLength(0);
	});

	it("fetches unconditionally when no manifest is readable", async () => {
		const ctx = createCtx({ status: "missing" });
		const instance = await setupChecker(async () => OLDER, ctx);

		const result = await instance.executeCommand({ type: "refetch.check" });

		expect(result._unsafeUnwrap()).toEqual({ modifiedAt: OLDER, fetched: true });
		expect(dispatchesOf(ctx, "content.fetch")).toHaveLength(1);
	});

	it("fetches unconditionally when the manifest read command itself fails", async () => {
		const ctx = createCtx();
		ctx.dispatchCommand.mockImplementation((command: BaseCommand) =>
			command.type === "content.manifest.read"
				? errAsync(new Error("no content plugin registered"))
				: okAsync(undefined),
		);
		const instance = await setupChecker(async () => OLDER, ctx);

		const result = await instance.executeCommand({ type: "refetch.check" });

		expect(result._unsafeUnwrap()).toEqual({ modifiedAt: OLDER, fetched: true });
		expect(dispatchesOf(ctx, "content.fetch")).toHaveLength(1);
	});

	it("compares against the in-memory value instead of the manifest after the first check", async () => {
		const ctx = createCtx();
		const values = [NEWER, NEWER];
		const instance = await setupChecker(async () => values.shift() ?? NEWER, ctx);

		await instance.executeCommand({ type: "refetch.check" });
		const second = await instance.executeCommand({ type: "refetch.check" });

		expect(second._unsafeUnwrap()).toEqual({ modifiedAt: NEWER, fetched: false });
		expect(dispatchesOf(ctx, "content.fetch")).toHaveLength(1);
		expect(dispatchesOf(ctx, "content.manifest.read")).toHaveLength(1);
	});

	it("retries the fetch on the next check when a fetch fails", async () => {
		const ctx = createCtx();
		let failFetch = true;
		ctx.dispatchCommand.mockImplementation((command: BaseCommand) => {
			if (command.type === "content.manifest.read") {
				return okAsync({ status: "ok", manifest } satisfies ManifestReadCommandResult);
			}
			return failFetch ? errAsync(new Error("fetch failed")) : okAsync(undefined);
		});
		const instance = await setupChecker(async () => NEWER, ctx);

		const first = await instance.executeCommand({ type: "refetch.check" });
		expect(first).toBeErr();

		failFetch = false;
		const second = await instance.executeCommand({ type: "refetch.check" });

		expect(second._unsafeUnwrap()).toEqual({ modifiedAt: NEWER, fetched: true });
		expect(dispatchesOf(ctx, "content.fetch")).toHaveLength(2);
	});

	it("reads the manifest from disk when downloadPath is set", async () => {
		vol.mkdirSync("/custom", { recursive: true });
		vol.writeFileSync("/custom/manifest.json", JSON.stringify(manifest));
		const ctx = createCtx();
		const instance = await setupChecker(async () => OLDER, ctx, "custom");

		const result = await instance.executeCommand({ type: "refetch.check" });

		expect(result._unsafeUnwrap()).toEqual({ modifiedAt: OLDER, fetched: false });
		expect(dispatchesOf(ctx, "content.manifest.read")).toHaveLength(0);
	});

	it("propagates a failing freshness probe without fetching", async () => {
		const ctx = createCtx();
		const instance = await setupChecker(async () => {
			throw new Error("CMS unreachable");
		}, ctx);

		const result = await instance.executeCommand({ type: "refetch.check" });

		expect(result).toBeErr();
		expect(result._unsafeUnwrapErr().message).toBe("CMS unreachable");
		expect(ctx.dispatchCommand).not.toHaveBeenCalled();
	});

	it("passes the plugin abort signal to the freshness probe", async () => {
		const ctx = createCtx();
		const getLatestModifiedAt = vi.fn(async () => NEWER);
		const instance = await setupChecker(getLatestModifiedAt, ctx);

		await instance.executeCommand({ type: "refetch.check" });

		expect(getLatestModifiedAt).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ctx.abortSignal, logger: ctx.logger }),
		);
	});

	it("rejects unknown command types", async () => {
		const ctx = createCtx();
		const instance = await setupChecker(async () => NEWER, ctx);

		const invalidCommand = { type: "refetch.nope" } as unknown as RefetchCheckCommand;
		const result = await instance.executeCommand(invalidCommand);

		expect(result).toBeErr();
		expect(dispatchesOf(ctx, "content.fetch")).toHaveLength(0);
	});
});
