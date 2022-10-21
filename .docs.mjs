import jsdoc2md from 'jsdoc-to-markdown';
import fs from 'fs-extra';
import path from 'path';

/**
 * 
 * @param {Object} options @see https://github.com/jsdoc2md/jsdoc-to-markdown/blob/master/docs/API.md#jsdoc2mdrenderoptions--promise
 * @param {string} destination 
 */
const createDocs = async (options, destination) => {
	if (options.templatePath) {
		options.template = fs.readFileSync(options.templatePath).toString();
	}
	return await jsdoc2md.render(options).then((result) => {
		fs.ensureDirSync(path.dirname(destination));
		fs.writeFileSync(destination, result);
	});
}

const defaults = {files: 'packages/**/lib/*.js'};

await createDocs({...defaults, templatePath: 'packages/content/README.hbs'}, 'packages/content/README.md');
