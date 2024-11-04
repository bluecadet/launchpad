/**
 * @typedef {Object} Callback
 * @property {() => (Promise<void> | void)} callback
 * @property {boolean} once
 * @property {boolean} includeUncaught
 */

let didTrigger = false;

/** @type {Callback[]} */
const callbacks = [];

const events = ['beforeExit', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'];

events.forEach(event => process.on(event, async (event) => {
	for (const callback of callbacks) {
		if (callback.once && didTrigger) {
			continue;
		}
		await callback.callback();
	}
	didTrigger = true;
}));

const unhandledEvents = ['uncaughtException', 'unhandledRejection'];

unhandledEvents.forEach(event => process.on(event, async (event) => {
	const filteredCallbacks = callbacks.filter(callback => callback.includeUncaught);
	for (const callback of filteredCallbacks) {
		if (callback.once && didTrigger) {
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
