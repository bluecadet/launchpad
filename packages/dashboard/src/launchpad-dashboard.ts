import { defineSubsystem } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import chalk from "chalk";
import { H3, onError, serve } from "h3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type DashboardConfig, dashboardConfigSchema } from "./dashboard-config.js";
import { DashboardRegistryImpl } from "./lib/dashboard-registry.js";

export function createLaunchpadDashboard(config: DashboardConfig) {
	return defineSubsystem({
		name: "dashboard",
		setup(_ctx) {
			const configResult = dashboardConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(new Error("Invalid monitor configuration", { cause: configResult.error }));
			}
			const resolvedConfig = configResult.data;

			const app = new H3();

			const _registry = new DashboardRegistryImpl(app);

			const server = serve(app, {
				port: resolvedConfig.port,
				hostname: resolvedConfig.host,
				silent: true,
				gracefulShutdown: false,
			});

			app.use((event) => {
				// log requests if enabled
				const { method, url } = event.req;
				_ctx.logger.debug(`${method} ${url}`);
			});

			app.use(
				onError((event, error) => {
					const level = event.status && event.status >= 500 ? "error" : "warn";

					const msg = `[${chalk[level === "error" ? "red" : "yellow"](event.status)}] Error processing request: ${error.req.method} ${error.req.url}`;
					if (level === "error") {
						_ctx.logger.error({
							message: new Error(msg, { cause: event }),
						});
					} else {
						_ctx.logger.warn(msg);
					}
				}),
			);

			return okAsync({
				// Expose the registry so the controller can pass it to other subsystems
				getRegistry() {
					return _registry;
				},
				disconnect() {
					return ResultAsync.fromPromise(server.close(), (e) => e as Error);
				},
			});
		},
	});
}
