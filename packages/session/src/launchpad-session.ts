import { ensureError } from "@bluecadet/launchpad-utils/errors";
import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { SessionBroker } from "./broker/session-broker.js";
import { SessionError } from "./errors.js";
import { type SessionCommand, sessionCommandSchema } from "./session-commands.js";
import { type SessionConfig, sessionConfigSchema } from "./session-config.js";
import type { SessionState } from "./session-state.js";
import { buildSessionSection } from "./session-summarize.js";

import "./session-events.js";

/**
 * Creates the Station session broker plugin.
 *
 * One Node runs one Station, so the broker holds exactly one Session at a time: a tap
 * with a new Credential replaces whatever was there, the same Credential refreshes it,
 * and quiet ends it. Apps read the Session through `session.current` and the
 * `session:*` events rather than talking to the vendor themselves.
 *
 * @example
 * ```ts
 * import { session } from '@bluecadet/launchpad-session';
 * import { fakeVendor } from '@bluecadet/launchpad-session/vendors/fake';
 *
 * plugins: [session({ vendor: fakeVendor(), idleTimeoutMs: 90_000 })]
 * ```
 */
export function session(config: SessionConfig) {
	return definePlugin({
		name: "session",
		manifest: {
			commands: [
				{
					id: "session.current",
					description: "Read the current Session and the Profile behind it.",
					parser: sessionCommandSchema,
				},
				{
					id: "session.end",
					description: "End the current Session now.",
					parser: sessionCommandSchema,
				},
				{
					id: "session.tap.simulate",
					description: "Feed a Credential through the real tap path. Dev and QA only.",
					parser: sessionCommandSchema,
				},
			],
		},
		summarize(state: LaunchpadState): Section | null {
			const sessionState = state.plugins.session;
			return sessionState ? buildSessionSection(sessionState) : null;
		},
		setup(ctx: PluginContext<SessionState>) {
			const parsedConfig = sessionConfigSchema.safeParse(config);
			if (!parsedConfig.success) {
				return errAsync(
					new SessionError("Invalid session configuration", { cause: parsedConfig.error }),
				);
			}

			const broker = new SessionBroker(parsedConfig.data, {
				logger: ctx.logger,
				eventBus: ctx.eventBus,
				updateState: ctx.updateState,
				abortSignal: ctx.abortSignal,
			});
			broker.start();

			return okAsync({
				executeCommand(command: SessionCommand) {
					const parsed = sessionCommandSchema.safeParse(command);
					if (!parsed.success) {
						return errAsync(new SessionError(`Invalid command: ${parsed.error.message}`));
					}

					switch (parsed.data.type) {
						case "session.current":
							return okAsync(broker.current());
						case "session.end":
							return okAsync(broker.end());
						case "session.tap.simulate":
							return ResultAsync.fromPromise(
								broker.simulateTap(parsed.data.credential),
								ensureError,
							);
						default: {
							parsed.data satisfies never;
							return errAsync(new SessionError("Unreachable: unknown command type"));
						}
					}
				},
				disconnect(_reason: DisconnectReason) {
					return broker.stop();
				},
			});
		},
	});
}
