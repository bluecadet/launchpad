/**
 * @type {import('markdown-it/lib/renderer.js').RenderRule}
 */
function render(tokens, idx, options, _env, self) {
	const token = tokens[idx];
	if (token.markup === '*' || token.markup === '_') {
		token.tag = 'i';
	} else if (token.markup === '**' || token.markup === '__') {
		token.tag = 'b';
	}
	return self.renderToken(tokens, idx, options);
}

/**
 * @type {import('markdown-it').PluginSimple}
 */
export default (md) => {
	md.renderer.rules.em_open = render;
	md.renderer.rules.em_close = render;
	md.renderer.rules.strong_open = render;
	md.renderer.rules.strong_close = render;
};
