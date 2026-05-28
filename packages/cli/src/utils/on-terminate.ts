/**
 * Registers a callback to be invoked on process termination signals (SIGINT, SIGTERM, SIGHUP).
 * SIGHUP is emitted when the terminal window is closed (e.g. via the X button).
 * Returns a function to unregister the callback.
 */
export function onTerminate(callback: () => void): () => void {
	process.on("SIGINT", callback);
	process.on("SIGTERM", callback);
	process.on("SIGHUP", callback);

	return () => {
		process.off("SIGINT", callback);
		process.off("SIGTERM", callback);
		process.off("SIGHUP", callback);
	};
}
