/**
 * @module launchpad-options
 */

import { LogOptions } from '@bluecadet/launchpad-utils';
import { ContentOptions } from '@bluecadet/launchpad-content';
import { MonitorOptions } from '@bluecadet/launchpad-monitor';
import { ServerOptions } from '@bluecadet/launchpad-server';
import { CommandOptions } from './command-center.js';
import { CommandHooks } from './command-hooks.js';

/**
 * Combined options to initialize Launchpad.
 */
export class LaunchpadOptions {
	constructor({
		content = new ContentOptions(),
		monitor = new MonitorOptions(),
		server = new ServerOptions(),
		commands = new CommandOptions(),
		hooks = new CommandHooks(),
		logging = new LogOptions(),
		...rest
	} = {}) {
		
		/**
		 * @type {ContentOptions}
		 */
		this.content = new ContentOptions(content);
		
		/**
		 * @type {MonitorOptions}
		 */
		this.monitor = new MonitorOptions(monitor);

		/**
		 * @type {ServerOptions}
		 */
		this.server = new ServerOptions(server);

		/**
		 * @type {CommandOptions}
		 */
		this.commands = new CommandOptions(commands);
		
		/**
		 * @type {CommandHooks}
		 */
		 this.hooks = new CommandHooks(hooks);
		 
		/**
		 * @type {LogOptions}
		 */
		this.logging = new LogOptions(logging);
		
		Object.assign(this, rest);
	}
}

export default LaunchpadOptions;
