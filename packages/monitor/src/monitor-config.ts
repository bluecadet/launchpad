import type { StartOptions } from "pm2";
import { z } from "zod";

const windowsApiConfigSchema = z.object({
	/**
	 * The delay until windows are ordered after launch of in ms. Defaults to 3000.
	 * If your app takes a long time to open all of its windows, set this number to a higher value to ensure it can be on top of the launchpad terminal window. Keeping this high also reduces the CPU load if apps relaunch often.
	 * see https://github.com/node-ffi-napi/ref-napi/issues/54#issuecomment-1029639256
	 */
	debounceDelay: z
		.number()
		.default(3000)
		.describe(
			"The delay until windows are ordered after launch of in ms. Defaults to 3000. If your app takes a long time to open all of its windows, set this number to a higher value to ensure it can be on top of the launchpad terminal window. Keeping this high also reduces the CPU load if apps relaunch often.",
		),
});

export type WindowsApiConfig = z.infer<typeof windowsApiConfigSchema>;

const windowConfigSchema = z.object({
	/** Move this app to the foreground once all apps have been launched. Defaults to false. */
	foreground: z
		.boolean()
		.default(false)
		.describe(
			"Move this app to the foreground once all apps have been launched. Defaults to false.",
		),
	/** Minimize this app's windows once all apps have been launched. Defaults to false. */
	minimize: z
		.boolean()
		.default(false)
		.describe("Minimize this app's windows once all apps have been launched. Defaults to false."),
	/** Completely hide this app's windows once all apps have been launched. Helpful for headless apps, but note that this might cause issues with GUI-based apps. Defaults to false. */
	hide: z
		.boolean()
		.default(false)
		.describe(
			"Completely hide this app's windows once all apps have been launched. Helpful for headless apps, but note that this might cause issues with GUI-based apps. Defaults to false.",
		),
});

export type WindowConfig = z.infer<typeof windowConfigSchema>;

/**
 * Options for how an app's windows should be managed.
 */
export const logModesSchema = z.enum([
	/** Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad. */
	"file",
	/** Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app. */
	"bus",
]);

export const LogModes = logModesSchema.Enum;

/**
 * Options for how an app's logs should be saved, routed and displayed.
 */
const appLogConfigSchema = z.object({
	/** Route application logs to launchpad's log dir instead of pm2's log dir. Defaults to true. */
	logToLaunchpadDir: z
		.boolean()
		.default(true)
		.describe(
			"Route application logs to launchpad's log dir instead of pm2's log dir. Defaults to true.",
		),
	/** How to grab the app's logs. Supported values: - 'bus': Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app. - 'file': Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad. Defaults to 'bus'. */
	mode: logModesSchema
		.default("bus")
		.describe(
			"How to grab the app's logs. Supported values: - 'bus': Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app. - 'file': Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad. Defaults to 'bus'.",
		),
	/** Whether or not to include output from `stdout`. Defaults to true. */
	showStdout: z
		.boolean()
		.default(true)
		.describe("Whether or not to include output from `stdout`. Defaults to true."),
	/** Whether or not to include output from `stderr`. Defaults to true. */
	showStderr: z
		.boolean()
		.default(true)
		.describe("Whether or not to include output from `stderr`. Defaults to true."),
});

export type AppLogConfig = z.infer<typeof appLogConfigSchema>;

/**
 * Options for an individual app to monitor.
 */
const appConfigSchema = z.object({
	/** pm2 configuration for this app. see https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available */
	pm2: z
		.custom<StartOptions>()
		.and(
			z.object({
				out_file: z.string().optional().describe("The file to write stdout to."),
				error_file: z.string().optional().describe("The file to write stderr to."),
			}),
		)
		.describe(
			"pm2 configuration for this app. see https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available",
		),
	/** Optional settings for moving this app's main windows to the foreground, minimize or hide them. */
	windows: windowConfigSchema
		.describe(
			"Optional settings for moving this app's main windows to the foreground, minimize or hide them.",
		)
		.default({}),
	/** Optional settings for how to log this app's output. */
	logging: appLogConfigSchema
		.describe("Optional settings for how to log this app's output.")
		.default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Top-level options of Launchpad Monitor.
 */
export const monitorConfigSchema = z.object({
	/** A list of apps to launch and monitor. */
	apps: z.array(appConfigSchema).default([]).describe("A list of apps to launch and monitor."),
	/** Set this to true to delete existing PM2 processes before connecting. If you're running volatile apps or your node process might be quit unexpectedly, this can be helpful to start with a clean slate on startup. */
	deleteExistingBeforeConnect: z
		.boolean()
		.default(true)
		.describe(
			"Set this to true to delete existing PM2 processes before connecting. If you're running volatile apps or your node process might be quit unexpectedly, this can be helpful to start with a clean slate on startup.",
		),
	/** Advanced configuration for the Windows API, e.g. for managing foreground/minimized/hidden windows. */
	windowsApi: windowsApiConfigSchema
		.describe(
			"Advanced configuration for the Windows API, e.g. for managing foreground/minimized/hidden windows.",
		)
		.default({}),
	/** Will listen for exit events. Defaults to true. */
	shutdownOnExit: z
		.boolean()
		.default(true)
		.describe("Will listen for exit events. Defaults to true."),
});

export type MonitorConfig = z.input<typeof monitorConfigSchema>;
export type ResolvedMonitorConfig = z.output<typeof monitorConfigSchema>;
export type ResolvedAppConfig = ResolvedMonitorConfig["apps"][number];

export function defineMonitorConfig(config: MonitorConfig) {
	return config;
}
