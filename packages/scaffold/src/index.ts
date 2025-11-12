import * as path from "node:path";
import * as sudo from "sudo-prompt";

export function launchScaffold() {
	if (process.platform !== "win32") {
		console.error("Launchpad Scaffold currently only supports Windows");
		console.error("Exiting...");
		process.exit(1);
	}

	console.info("Starting Launchpad Scaffold script...");

	return sudo.exec(
		`start ${path.resolve(import.meta.dirname, "../setup.bat")}`,
		{
			name: "Launchpad Scaffold",
		},
		(error, stdout, _stderr) => {
			if (error) throw error;
			console.log(stdout);
		},
	);
}
