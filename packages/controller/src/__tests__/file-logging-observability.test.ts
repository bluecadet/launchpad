import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type LogExporter,
	type ObservabilityDestination,
	observability,
} from "@bluecadet/launchpad-observability";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { LoggerSource } from "@bluecadet/launchpad-utils/logging";
import { definePlugin } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, ok, okAsync } from "neverthrow";
import { expect, it, vi } from "vitest";
import { controllerConfigSchema } from "../controller-config.js";
import { LaunchpadController } from "../launchpad-controller.js";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

it("replays offline canonical logs with historical identity and resumes the acknowledged checkpoint after another restart", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "launchpad-controller-replay-"));
	const controllers: LaunchpadController[] = [];
	const config = controllerConfigSchema.parse({
		logging: { dirname: "logs", overrideConsole: false, text: { enabled: false } },
	});
	const offline = vi.fn<LogExporter["export"]>(() =>
		errAsync(Object.assign(new Error("offline"), { retryable: true, retryAfterMs: 60_000 })),
	);
	const online = vi.fn<LogExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
	const afterAck = vi.fn<LogExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));

	async function startSession(exportLogs: LogExporter["export"], installation: string) {
		const controller = new LaunchpadController(config, directory);
		controllers.push(controller);
		let source: LoggerSource | undefined;
		let logger: Logger | undefined;
		const probe = await controller.registerPlugin(
			definePlugin({
				name: "probe",
				setup(ctx) {
					source = ctx.logSource;
					logger = ctx.logger;
					return okAsync({});
				},
			}),
		);
		expect(probe.isOk()).toBe(true);
		if (!source || !logger) throw new Error("The real canonical source must be available");
		const destination: ObservabilityDestination = {
			name: "integration",
			checkpointKey: "stable-route",
			create: () => ok({ logs: { supportsResourceContext: true, export: exportLogs } }),
		};
		const registration = await controller.registerPlugin(
			observability({
				destinations: [destination],
				logStorage: { type: "file" },
				resource: { installation },
				include: ["log:info"],
				metrics: false,
				batch: { maxEntries: 100, intervalMs: 10 },
				buffer: { maxBatches: 10, maxRetries: 1 },
				delivery: { deliveryTimeoutMs: 100, shutdownTimeoutMs: 100 },
			}),
		);
		expect(registration.isOk()).toBe(true);
		expect((await controller.start()).isOk()).toBe(true);
		expect((await controller.ready()).isOk()).toBe(true);
		return { controller, source, logger };
	}

	try {
		const first = await startSession(offline, "original-installation");
		first.logger.info("Retained offline record", { password: "must-not-persist" });
		await first.source.flush(AbortSignal.timeout(2_000));
		await vi.waitFor(() => expect(offline).toHaveBeenCalled());
		const original = offline.mock.calls[0];
		if (!original) throw new Error("Expected an offline export attempt");
		expect(original[0]).toHaveLength(1);
		expect(original[1].resourceAttributes).toMatchObject({
			installation: "original-installation",
			"service.instance.id": first.source.identity.runtimeId,
		});
		expect(original[1].recordFormat).toBe("canonical");
		expect(JSON.stringify(original[0])).not.toContain("must-not-persist");
		expect((await first.controller.stop()).isOk()).toBe(true);

		const second = await startSession(online, "new-installation");
		expect(second.source.identity.sourceId).toBe(first.source.identity.sourceId);
		expect(second.source.identity.runtimeId).not.toBe(first.source.identity.runtimeId);
		expect((await second.controller.executeCommand({ type: "observability.flush" })).isOk()).toBe(
			true,
		);
		await vi.waitFor(() => expect(online).toHaveBeenCalledOnce());
		const replay = online.mock.calls[0];
		expect(replay?.[0]).toEqual(original[0]);
		expect(replay?.[0][0]?.timestamp).toBeInstanceOf(Date);
		expect(replay?.[1].resourceAttributes).toEqual(original[1].resourceAttributes);
		expect(replay?.[1].recordFormat).toBe("canonical");
		expect((await second.controller.stop()).isOk()).toBe(true);

		const third = await startSession(afterAck, "third-installation");
		expect((await third.controller.executeCommand({ type: "observability.flush" })).isOk()).toBe(
			true,
		);
		expect(afterAck).not.toHaveBeenCalled();
		third.logger.info("New record after checkpoint");
		expect((await third.controller.executeCommand({ type: "observability.flush" })).isOk()).toBe(
			true,
		);
		await vi.waitFor(() => expect(afterAck).toHaveBeenCalledOnce());
		expect(
			afterAck.mock.calls.flatMap(([entries]) => entries.map((entry) => entry.message)),
		).toEqual(["New record after checkpoint"]);
		expect(afterAck.mock.calls[0]?.[1].resourceAttributes).toMatchObject({
			installation: "third-installation",
			"service.instance.id": third.source.identity.runtimeId,
		});
	} finally {
		for (const controller of controllers) await controller.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
