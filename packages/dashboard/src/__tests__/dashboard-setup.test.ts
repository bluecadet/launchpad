import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { describe, expect, it, vi } from "vitest";
import type { DashboardState } from "../dashboard-state.js";
import { dashboard } from "../launchpad-dashboard.js";

function makeMockCtx(): PluginContext<DashboardState> {
	return {
		eventBus: {
			emit: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			onAny: vi.fn(),
			offAny: vi.fn(),
			onPattern: vi.fn(),
			once: vi.fn(),
			removeAllListeners: vi.fn(),
			listenerCount: vi.fn(),
		} as unknown as PluginContext<DashboardState>["eventBus"],
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			verbose: vi.fn(),
			debug: vi.fn(),
			child: vi.fn(),
		} as unknown as PluginContext<DashboardState>["logger"],
		abortSignal: new AbortController().signal,
		cwd: "/tmp",
		dispatchCommand: vi.fn(),
		getGlobalState: vi.fn().mockReturnValue({
			system: { startTime: new Date(), mode: "task" },
			plugins: {},
			_version: 0,
		}),
		onGlobalStatePatch: vi.fn().mockReturnValue(vi.fn()),
		updateState: vi.fn(),
	};
}

describe("dashboard() setup validation", () => {
	it("returns errAsync for invalid config (port out of range)", async () => {
		const plugin = dashboard({ port: 0 });
		const result = await plugin.setup(makeMockCtx());
		expect(result.isErr()).toBe(true);
	});

	it("returns errAsync for duplicate page IDs", async () => {
		const plugin = dashboard({
			port: 3000,
			pages: [
				{ id: "monitor", title: "Monitor" },
				{ id: "monitor", title: "Monitor Again" },
			],
		});
		const result = await plugin.setup(makeMockCtx());
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toContain("monitor");
	});

	it("returns errAsync for duplicate panel IDs", async () => {
		const sharedPanel = { id: "status", title: "Status", render: () => "" };
		const plugin = dashboard({
			port: 3000,
			panels: [sharedPanel, sharedPanel],
		});
		const result = await plugin.setup(makeMockCtx());
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toContain("status");
	});

	it("returns errAsync for duplicate panel IDs across pages and overview", async () => {
		const panel = { id: "status", title: "Status", render: () => "" };
		const plugin = dashboard({
			port: 3000,
			pages: [{ id: "home", title: "Home", panels: [panel] }],
			panels: [panel],
		});
		const result = await plugin.setup(makeMockCtx());
		expect(result.isErr()).toBe(true);
	});

	it("returns okAsync for a valid configuration", async () => {
		const plugin = dashboard({ port: 3000 });
		const result = await plugin.setup(makeMockCtx());
		expect(result.isOk()).toBe(true);
	});

	it("subscribes to global state patches during setup", async () => {
		const ctx = makeMockCtx();
		const plugin = dashboard({ port: 3000 });
		await plugin.setup(ctx);
		expect(ctx.onGlobalStatePatch).toHaveBeenCalledOnce();
	});

	it("unsubscribes from state patches on disconnect", async () => {
		const unsubscribe = vi.fn();
		const ctx = makeMockCtx();
		vi.mocked(ctx.onGlobalStatePatch).mockReturnValue(unsubscribe);

		const plugin = dashboard({ port: 3000 });
		const result = await plugin.setup(ctx);
		const instance = result._unsafeUnwrap();

		await instance.disconnect?.({ type: "manual" });
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
