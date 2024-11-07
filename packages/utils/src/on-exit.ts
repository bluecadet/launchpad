interface Callback {
	callback: () => Promise<void> | void;
	once: boolean;
	includeUncaught: boolean;
}

let didTrigger = false;
const callbacks: Callback[] = [];

const events = [
	"beforeExit",
	"SIGHUP",
	"SIGINT",
	"SIGQUIT",
	"SIGILL",
	"SIGTRAP",
	"SIGABRT",
	"SIGBUS",
	"SIGFPE",
	"SIGUSR1",
	"SIGSEGV",
	"SIGUSR2",
	"SIGTERM",
	"uncaughtException",
	"unhandledRejection",
] as const;

for (const event of events) {
	process.on(event, async (event) => {
		const thisIsFirstTrigger = !didTrigger;
		didTrigger = true;

		for (const callback of callbacks) {
			if (callback.once && !thisIsFirstTrigger) {
				continue;
			}

			if (
				!callback.includeUncaught &&
				(event === "uncaughtException" || event === "unhandledRejection")
			) {
				continue;
			}

			await callback.callback();
		}
	});
}

export const onExit = (
	callback: () => Promise<void> | void = async () => {},
	once = true,
	includeUncaught = false,
): void => {
	callbacks.push({ callback, once, includeUncaught });
};

export default onExit;

/** @internal */
export function _reset(): void {
	didTrigger = false;
	callbacks.length = 0;
}
