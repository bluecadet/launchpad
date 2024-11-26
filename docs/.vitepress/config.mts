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

	head: [
		[
			"link",
			{
				rel: "icon",
				href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🚀</text></svg>",
			},
		],
		["meta", { name: "author", content: "Bluecadet" }],
		["meta", { name: "og:title", content: "🚀 Launchpad" }],
		[
			"meta",
			{
				name: "og:description",
				content:
					"A comprehensive toolkit for managing interactive media installations. Includes content management, process monitoring, and automated deployment tools.",
			},
		],
		["meta", { name: "og:type", content: "website" }],
		["meta", { name: "og:url", content: "https://bluecadet.github.io/launchpad/" }],
		[
			"meta",
			{
				name: "keywords",
				content:
					"media installations, content management, process monitoring, deployment tools, interactive media, digital experiences, launchpad, pm2, cms integration",
			},
		],
		["meta", { name: "robots", content: "index, follow" }],
		["meta", { name: "viewport", content: "width=device-width, initial-scale=1.0" }],
	],

	// add canonical link to head
	transformPageData(pageData, ctx) {
		const canonicalUrl = `https://bluecadet.github.io/launchpad/${pageData.relativePath}`
			.replace(/index\.md$/, "")
			.replace(/\.md$/, ".html");

		pageData.frontmatter.head ??= [];
		pageData.frontmatter.head.push(["link", { rel: "canonical", href: canonicalUrl }]);
	},

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
				text: `v${pkg.version}`,
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
			{
				text: "Bluecadet",
				link: "https://bluecadet.com",
			},
		],

		sidebar: [
			{
				text: "Guides",
				items: [
					{ text: "Introduction", link: "/" },
					{ text: "Getting Started", link: "/guides/getting-started" },
					{ text: "Fetching Content", link: "/guides/fetching-content" },
					{ text: "Downloading Media", link: "/guides/downloading-media" },
					{ text: "Running Applications", link: "/guides/running-applications" },
				],
			},
			{
				text: "Recipes",
				items: [
					{ text: "Custom Content Source", link: "/recipes/custom-content-source" },
					{ text: "Custom Content Plugin", link: "/recipes/custom-content-plugin" },
					{ text: "Custom Monitor Plugin", link: "/recipes/custom-monitor-plugin" },
				],
			},
			{
				text: "Reference",
				items: [
					{
						text: "CLI",
						link: "/reference/cli",
						items: [
							{ text: "Env", link: "/reference/cli/env" },
							{ text: "Config Loading", link: "/reference/cli/config-loading" },
							{ text: "Commands", link: "/reference/cli/commands" },
						],
					},
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
						items: [{ text: "Scaffold Config", link: "/reference/scaffold/scaffold-config" }],
					},
				],
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
