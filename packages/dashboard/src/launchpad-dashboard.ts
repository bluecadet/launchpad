import { defineSubsystem } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { errAsync, okAsync } from "neverthrow";
import { type DashboardConfig, dashboardConfigSchema } from "./dashboard-config.js";
import { DashboardRegistryImpl } from "./lib/dashboard-registry.js";
import { SimpleRouter } from "./lib/simple-router.js";

export function createLaunchpadDashboard(config: DashboardConfig) {
	return defineSubsystem({
		name: "dashboard",
		setup(ctx) {
			const configResult = dashboardConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(new Error("Invalid monitor configuration", { cause: configResult.error }));
			}
			const resolvedConfig = configResult.data;

			const router = new SimpleRouter(ctx.logger);
			const registry = new DashboardRegistryImpl(router);

			const stopRouter = router.listen(resolvedConfig.port, resolvedConfig.host);

			return okAsync({
				// Expose the registry so the controller can pass it to other subsystems
				getRegistry() {
					return registry;
				},
				disconnect() {
					return stopRouter();
				},
			});
		},
	});
}
