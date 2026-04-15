import { DashboardRegistry } from "@bluecadet/launchpad-utils/panel-registry";
import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { StatusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:http", () => ({
	createServer: vi.fn(() => ({
		listen: vi.fn((_port: number, _host: string, cb?: () => void) => cb?.()),
		close: vi.fn((cb?: () => void) => cb?.()),
		on: vi.fn(),
	})),
}));

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
		dashboardRegistry: new DashboardRegistry(),
		statusRegistry: new StatusRegistry(),
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

	it("calls unsubscribe on disconnect", async () => {
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
