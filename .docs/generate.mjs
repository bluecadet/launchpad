import jsdoc2md from 'jsdoc-to-markdown';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { ConfigManager, LogManager } from '@bluecadet/launchpad-utils';

const config = ConfigManager.getInstance().getConfig();
const logger = LogManager.getInstance(config).getLogger('docs');

/**
 * 
 * @param {Object} options @see https://github.com/jsdoc2md/jsdoc-to-markdown/blob/master/docs/API.md#jsdoc2mdrenderoptions--promise
 * @param {string} options.templatePath Optional template .hbs file to use 
 * @param {string} options.outputPath Path of the output file
 */
const renderDocs = async (options) => {
	if (options.templatePath) {
		options.template = fs.readFileSync(options.templatePath).toString();
	}
	logger.info(`Rendering ${chalk.yellow(options.outputPath)}`);
	return await jsdoc2md.render(options).then((result) => {
		fs.ensureDirSync(path.dirname(options.outputPath));
		fs.writeFileSync(options.outputPath, result);
	});
}

const renderSourceDocs = async (sources) => {
	for (const source of sources) {
		await renderDocs({
			...defaults,
			files: `packages/content/lib/content-sources/${source}-source.js`,
			templatePath: `packages/content/.docs/${source}-source.hbs`,
			outputPath: `packages/content/docs/${source}-source.md`
		});
	}
}

const defaults = {
	"files": "packages/**/lib/*.js",
	"heading-depth": 2,
	"name-format": true,
	"separators": true,
	"partial": [".docs/partials/class-members.hbs"],
	"helper": [".docs/helpers/helpers.js"],
	"module-index-format": "list",
	"global-index-format": "list",
	"param-index-format": "list",
	"property-index-format": "list",
	"member-index-format": "grouped"
};

await renderDocs({...defaults, templatePath: 'packages/content/README.hbs', outputPath: 'packages/content/README.md'});
await renderSourceDocs(['airtable', 'contentful', 'json', 'sanity', 'strapi']);