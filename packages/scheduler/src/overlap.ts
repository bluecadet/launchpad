import { CommandInProgressError } from "@bluecadet/launchpad-utils/command-guard";

/**
 * `ctx.dispatchCommand` wraps a rejected `SingleCommandGuard` in a `CommandExecutionError`
 * whose `cause` is the original `CommandInProgressError`. Checking both the error itself and
 * its cause keeps this independent of the controller's wrapping so it also works if a plugin
 * ever forwards the guard error unwrapped.
 */
export function isOverlapSkipError(error: Error): boolean {
	return error instanceof CommandInProgressError || error.cause instanceof CommandInProgressError;
}
