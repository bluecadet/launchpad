import { defineLoader } from "vitepress";
import launchpadPackage from "@bluecadet/launchpad/package.json" with { type: "json" };
import contentPackage from "@bluecadet/launchpad-content/package.json" with { type: "json" };
import monitorPackage from "@bluecadet/launchpad-monitor/package.json" with { type: "json" };
import cliPackage from "@bluecadet/launchpad-cli/package.json" with { type: "json" };
import scaffoldPackage from "@bluecadet/launchpad-scaffold/package.json" with { type: "json" };

export interface Data {
	launchpad: string;
	content: string;
	monitor: string;
	cli: string;
	scaffold: string;
}

declare const data: Data;

export { data };

export default defineLoader({
	async load(): Promise<Data> {
		return {
			launchpad: launchpadPackage.version,
			content: contentPackage.version,
			monitor: monitorPackage.version,
			cli: cliPackage.version,
			scaffold: scaffoldPackage.version,
		};
	},
});
