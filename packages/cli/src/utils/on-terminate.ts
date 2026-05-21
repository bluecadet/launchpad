/**
 * Registers a callback to be invoked on process termination signals (SIGINT, SIGTERM).
 * Returns a function to unregister the callback.
 */
export function onTerminate(callback: () => void): () => void {
	process.on("SIGINT", callback);
	process.on("SIGTERM", callback);

	return () => {
		process.off("SIGINT", callback);
		process.off("SIGTERM", callback);
	};
}
