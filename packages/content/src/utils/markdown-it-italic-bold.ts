import type { MarkdownIt, RendererRule } from "markdown-it";

const render: RendererRule = (tokens, idx, options, _env, self) => {
	const token = tokens[idx];

	if (!token) {
		return "";
	}

	if (token.markup === "*" || token.markup === "_") {
		token.tag = "i";
	} else if (token.markup === "**" || token.markup === "__") {
		token.tag = "b";
	}
	return self.renderToken(tokens, idx, options);
};

const plugin = (md: MarkdownIt): void => {
	md.renderer.rules.em_open = render;
	md.renderer.rules.em_close = render;
	md.renderer.rules.strong_open = render;
	md.renderer.rules.strong_close = render;
};

export default plugin;
