import * as path from "node:path";
import { LogManager, type Logger } from "@bluecadet/launchpad-utils";
import * as sudo from "sudo-prompt";

export function launchScaffold(parentLogger: Logger) {
	const logger = LogManager.getLogger("scaffold", parentLogger);

	if (process.platform !== "win32") {
		logger.error("Launchpad Scaffold currently only supports Windows");
		logger.error("Exiting...");
		process.exit(1);
	}

	logger.info("Starting Launchpad Scaffold script...");

	return sudo.exec(
		`start ${path.resolve(import.meta.dirname, "../setup.bat")}`,
		{
			name: "Launchpad Scaffold",
		},
		(error, stdout, stderr) => {
			if (error) throw error;
			console.log(stdout);
		},
	);
}
