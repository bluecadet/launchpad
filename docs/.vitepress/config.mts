import { defineConfig } from "vitepress";
import pkg from "../../packages/launchpad/package.json";

// https://vitepress.dev/reference/site-config
export default defineConfig({
	lang: "en-US",
	title: "Launchpad",
	description: "A suite of tools to manage media installations",
	lastUpdated: true,
	base: "/launchpad/",
	srcDir: "src",

	themeConfig: {
		siteTitle: "🚀 Launchpad",
		search: {
			provider: "local",
		},
		outline: {
			level: [2, 3],
		},
		nav: [
			{
				text: pkg.version,
				items: [
					{
						text: "Changelog",
						link: "https://github.com/bluecadet/launchpad/releases",
					},
					{
						text: "Contributing",
						link: "https://github.com/bluecadet/launchpad/blob/develop/CONTRIBUTING.md",
					},
				],
			},
		],

		sidebar: [
			{
				text: "Guides",
				items: [
					{ text: "Introduction", link: "/" },
					{ text: "Getting Started", link: "/guides/getting-started" },
				],
			},
			{
				text: "Reference",
				items: [
					{
						text: "Content",
						link: "/reference/content",
						items: [
							{ text: "Content Config", link: "/reference/content/content-config" },
							{
								text: "Sources",
								link: "/reference/content/sources",
								items: [
									{ text: "airtableSource", link: "/reference/content/sources/airtable-source" },
									{
										text: "contentfulSource",
										link: "/reference/content/sources/contentful-source",
									},
									{ text: "jsonSource", link: "/reference/content/sources/json-source" },
									{ text: "sanitySource", link: "/reference/content/sources/sanity-source" },
									{ text: "strapiSource", link: "/reference/content/sources/strapi-source" },
								],
							},
							{
								text: "Plugins",
								link: "/reference/content/plugins",
								items: [
									{ text: "mdToHtml", link: "/reference/content/plugins/md-to-html" },
									{ text: "sanityToHtml", link: "/reference/content/plugins/sanity-to-html" },
									{ text: "sanityToPlain", link: "/reference/content/plugins/sanity-to-plain" },
									{ text: "sanityToMd", link: "/reference/content/plugins/sanity-to-md" },
									{ text: "mediaDownloader", link: "/reference/content/plugins/media-downloader" },
									{ text: "sharp", link: "/reference/content/plugins/sharp" },
									{
										text: "sanityImageUrlTransform",
										link: "/reference/content/plugins/sanity-image-url-transform",
									},
								],
							},
							{ text: "DataStore", link: "/reference/content/data-store" },
						],
					},
					{
						text: "Monitor",
						link: "/reference/monitor",
						items: [
							{ text: "Monitor Config", link: "/reference/monitor/monitor-config" },
							{ text: "Plugins", link: "/reference/monitor/plugins" },
						],
					},
					{
						text: "Scaffold",
						link: "/reference/scaffold",
						items: [
							{ text: "Scaffold Config", link: "/reference/scaffold/scaffold-config" },
						],
					},
				],
			},
			{
				text: "Recipes",
				items: [],
			},
		],

		socialLinks: [{ icon: "github", link: "https://github.com/bluecadet/launchpad" }],

		editLink: {
			pattern: "https://github.com/bluecadet/launchpad/edit/develop/docs/:path",
			text: "Edit this page on GitHub",
		},

		footer: {
			message: "Released under the MIT License.",
			copyright: "Copyright © 2024 Bluecadet",
		},
	},
});
