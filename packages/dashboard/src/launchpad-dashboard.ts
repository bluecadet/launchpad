import { defineSubsystem } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import chalk from "chalk";
import { H3, onError, serve } from "h3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type DashboardConfig, dashboardConfigSchema } from "./dashboard-config.js";
import { DashboardRegistryImpl } from "./lib/dashboard-registry.js";
import { registerLogPanelFeatures } from "./lib/log-panel.js";

type RegisterCallback = (registry: DashboardRegistryImpl) => ResultAsync<void, Error>;

export function createLaunchpadDashboard(
	config: DashboardConfig,
	registerCallback: RegisterCallback,
) {
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

			return registerCallback(_registry)
				.andThen(() => registerLogPanelFeatures(_registry, _ctx.eventBus))
				.andThen(() => {
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

					// disable caching by default, except for static files served from the dashboard
					app.use((event) => {
						if (event.req.method === "GET" && !event.req.url?.startsWith("/static/")) {
							event.res.headers.set(
								"Cache-Control",
								"no-store, no-cache, must-revalidate, proxy-revalidate",
							);
						}
					});

					const server = serve(app, {
						port: resolvedConfig.port,
						hostname: resolvedConfig.host,
						silent: true,
						gracefulShutdown: false,
						manual: false,
					});

					return okAsync({
						// Expose the registry so the controller can pass it to other subsystems
						getRegistry() {
							return _registry;
						},
						disconnect() {
							return ResultAsync.fromPromise(server.close(), (e) => e as Error);
						},
					});
				});
		},
	});
}
