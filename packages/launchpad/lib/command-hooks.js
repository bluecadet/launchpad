/**
 * @module command-hooks
 */

/**
 * @typedef {Object<string, Array<string>>} HookMapping
 * @example
 * {
 * 	"pre-startup": ["taskkill /im explorer.exe"],
 * 	"post-startup": ["echo 'done'"]
 * }
 */

export class CommandHooks {
	/**
	 * @param {Record<string, HookMapping>} hooks 
	 */
	constructor(hooks = {}) {
		/**
		 * Formant: pre-<command>
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
	 * @param {Record<string, HookMapping>} hooks 
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
					this.preHooks.push(new ExecHook({ command, script }));
				} else {
					this.postHooks.push(new ExecHook({ command, script }));
				}
			}
		}
	}
}

export class ExecHook {
	/**
	 * @param {object} options
	 * @param {string} options.command
	 * @param {string} options.script
	 */
	constructor({
		command,
		script
	}) {
		/**
		 * @type {string}
		 */
		this.command = command;
		/**
		 * @type {string}
		 */
		this.script = script;
	}
}

export default CommandHooks;
