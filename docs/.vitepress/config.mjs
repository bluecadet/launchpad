import { defineConfig } from "vitepress";

/**
 * https://vitepress.dev/reference/site-config
 * @returns {import("vitepress").DefaultTheme.Config}
 */
export default defineConfig({
	lang: "en-US",
	title: "Launchpad",
	description: "highly configurable suite of tools to manage media installations",
	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config
		nav: [
			{ text: "Guide", link: "/guide/" },
			{ text: "Reference", link: "/reference/" },
		],

		sidebar: {
			"/guide/": {
				items: [
					// Todo: generate from files in guide dir?
					{
						text: "Introduction",
						collapsed: false,
						items: [
							{ text: "Getting Started", link: "/guide/" },
						],
					},
				],
			},
			"/reference/": {
				base: "/reference/",
				items: [
					// Todo: generate from files in reference dir?
				],
			},
		},

		socialLinks: [{ icon: "github", link: "https://github.com/bluecadet/launchpad" }],

		search: {
			provider: "local",
		},
	},
});
