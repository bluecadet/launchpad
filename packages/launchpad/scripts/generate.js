import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Clear dist folder
const distPath = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(distPath)) {
	fs.rmSync(distPath, { recursive: true, force: true });
}

// Define your packages
const packages = [
	{ name: "@bluecadet/launchpad-cli", alias: "cli" },
	{ name: "@bluecadet/launchpad-content", alias: "content" },
	{ name: "@bluecadet/launchpad-controller", alias: "controller" },
	{ name: "@bluecadet/launchpad-monitor", alias: "monitor" },
	{ name: "@bluecadet/launchpad-scaffold", alias: "scaffold" },
];

/**
 * @type {Record<string, { default: string; types: string }>}
 */
const reExports = {};

// for each export in the package.json of each package, generate a corresponding .js and .d.ts file
for (const pkg of packages) {
	try {
		const packageJson = (await import(`${pkg.name}/package.json`, { with: { type: "json" } }))
			.default;
		const exports = packageJson.exports;

		for (const exportPath in exports) {
			if (exportPath === "./package.json") {
				continue; // Skip package.json export
			}

			let exportKey = exportPath;
			if (exportKey.startsWith("./")) {
				exportKey = exportKey.slice(2);
			}
			if (exportKey === "." || exportKey === "") {
				exportKey = "index";
			}

			const jsFilePath = path.resolve(
				__dirname,
				"..",
				"dist",
				pkg.alias,
				`${exportKey}.js`,
			);
			const dtsFilePath = path.resolve(
				__dirname,
				"..",
				"dist",
				pkg.alias,
				`${exportKey}.d.ts`,
			);

			// Create directory if it doesn't exist
			const dir = path.dirname(jsFilePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const exportPathForImport = exportKey === "index" ? "" : `/${exportKey.replace(/\.js$/, "")}`;

			const content = `export * from "${pkg.name}${exportPathForImport}";\n`;

			// Generate .js file with re-export
			fs.writeFileSync(jsFilePath, content, "utf-8");
			// Generate .d.ts file with re-export
			fs.writeFileSync(dtsFilePath, content, "utf-8");

			reExports[`./${pkg.alias}${exportPathForImport}`] = {
				default: `./dist/${pkg.alias}/${exportKey}.js`,
				types: `./dist/${pkg.alias}/${exportKey}.d.ts`,
			};
		}
	} catch (error) {
		console.error(`Error processing package ${pkg.name}:`);
		console.error(error);
	}
}

const mainPackageJsonPath = path.resolve(__dirname, "../package.json");
const mainPackageJson = JSON.parse(fs.readFileSync(mainPackageJsonPath, "utf-8"));

// Update main package.json exports
mainPackageJson.exports = reExports;

// Write the updated main package.json back to disk
fs.writeFileSync(mainPackageJsonPath, JSON.stringify(mainPackageJson, null, 2), "utf-8");
