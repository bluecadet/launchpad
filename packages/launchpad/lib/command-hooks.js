/**
 * @module command-hooks
 */

/**
 * @typedef {'startup' | 'update-content' | 'start-apps' | 'shutdown' | 'stop-apps'} LaunchpadCommand
 */

/**
 * @typedef {`pre-${LaunchpadCommand}` | `post-${LaunchpadCommand}`} LaunchpadHook
 */

/**
 * @typedef {{[K in LaunchpadHook]?: string[]}} HookMapping
 * @example
 * {
 * 	"pre-startup": ["taskkill /im explorer.exe"],
 * 	"post-startup": ["echo 'done'"]
 * }
 */

export class CommandHooks {
	/**
	 * @param {HookMapping} hooks 
	 */
	constructor(hooks = {}) {
		/**
		 * Format: pre-<command>
		 * @type {Array<ExecHook>}
		 */
		this.preHooks = [];
		/**
		 * Format: post-<command>
		 * @type {Array<ExecHook>}
		 */
		this.postHooks = [];
		
		this.parse(hooks);
		
		Object.assign(this, hooks);
	}
	
	/**
	 * @param {HookMapping} hooks 
	 */
	parse(hooks = {}) {
		if (!hooks) {
			return;
		}
		for (let [key, scripts] of Object.entries(hooks)) {
			key = (key + '').toLowerCase();
			const command = key.replace('pre-', '').replace('post-', '');
			
			const scriptArray = Array.isArray(scripts) ? scripts : [scripts];
			
			for (const script of scriptArray) {
				if ((typeof script) !== 'string') {
					continue;
				}
				
				if (key.startsWith('pre-')) {
					this.preHooks.push({ command, script });
				} else {
					this.postHooks.push({ command, script });
				}
			}
		}
	}
}

/**
 * @typedef ExecHook
 * @property {string} command
 * @property {string} script
 */

export default CommandHooks;
