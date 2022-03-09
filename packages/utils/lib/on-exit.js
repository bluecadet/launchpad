/**
 * 
 * @param {function(Event):Promise} callback A callback that receives an event.
 * @param {boolean} once Only trigger callback once . Defaults to true.
 * @param {boolean} includeUncaught Also trigger on uncaught exceptions and rejections. Defaults to false. @see https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly.
 * 
 */
export const onExit = (callback = async () => {}, once = true, includeUncaught = false) => {
	let triggered = false;
	const events = ['beforeExit', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT','SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'];
	if (includeUncaught) {
		events.push('uncaughtException', 'unhandledRejection');
	}
	events.forEach(event => process.on(event, async (event) => {
		if (!once || !triggered) {
			await callback();
		}
		triggered = true;
	}));
}

export default onExit;
