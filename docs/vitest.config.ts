import { fileURLToPath } from "node:url";
import { getViteConfig } from "astro/config";
import { defineProject } from "vitest/config";

export default getViteConfig(
	defineProject({
		test: {
			name: "docs",
			environment: "node",
			include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
			setupFiles: "@bluecadet/launchpad-testing/setup.ts",
		},
	}),
	{
		root: fileURLToPath(new URL(".", import.meta.url)),
		configFile: false,
		logLevel: "silent",
	},
);
