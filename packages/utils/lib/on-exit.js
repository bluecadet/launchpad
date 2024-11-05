/**
 * @typedef {Object} Callback
 * @property {() => (Promise<void> | void)} callback
 * @property {boolean} once
 * @property {boolean} includeUncaught
 */

let didTrigger = false;

/** @type {Callback[]} */
const callbacks = [];

const events = ['beforeExit', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM', 'uncaughtException', 'unhandledRejection'];

events.forEach(event => process.on(event, async (event) => {
	const thisIsFirstTrigger = !didTrigger;
	didTrigger = true;

	for (const callback of callbacks) {
		if (callback.once && !thisIsFirstTrigger) {
			continue;
		}

		if (!callback.includeUncaught && (event === 'uncaughtException' || event === 'unhandledRejection')) {
			continue;
		}

		await callback.callback();
	}
}));

/**
 * 
 * @param {() => (Promise<void> | void)} callback A callback that receives an event.
 * @param {boolean} once Only trigger callback once . Defaults to true.
 * @param {boolean} includeUncaught Also trigger on uncaught exceptions and rejections. Defaults to false. @see https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly.
 * 
 */
export const onExit = (callback = async () => {}, once = true, includeUncaught = false) => {
	callbacks.push({ callback, once, includeUncaught });
};

export default onExit;

/**
 * @internal
 */
export function _reset() {
	didTrigger = false;
	callbacks.length = 0;
}
