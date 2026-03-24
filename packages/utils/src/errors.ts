export class PluginNotFoundError extends Error {
	readonly pluginName: string;

	constructor(pluginName: string) {
		super(`Plugin not found: ${pluginName}`);
		this.name = "PluginNotFoundError";
		this.pluginName = pluginName;
	}
}
