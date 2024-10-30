import { defineConfig } from 'vitepress'
import pkg from '../../packages/launchpad/package.json'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en-US',
  title: "Launchpad",
  description: "A suite of tools to manage media installations",
  lastUpdated: true,
  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      {
        text: pkg.version,
        items: [
          {
            text: 'Changelog',
            link: 'https://github.com/bluecadet/launchpad/releases'
          },
          {
            text: 'Contributing',
            link: 'https://github.com/bluecadet/launchpad/blob/develop/CONTRIBUTING.md'
          }
        ]
      }
    ],

    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Getting Started', link: '/guides/getting-started' },
        ]
      },
      {
        text: 'Content',
        items: [
          { text: 'Overview', link: '/content/overview' },
          { text: 'Caching & Updates', link: '/content/caching' }
        ]
      },
      {
        text: 'CLI',
        items: [
          { text: 'Commands', link: '/cli/commands' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/bluecadet/launchpad' }
    ],

    editLink: {
      pattern: 'https://github.com/bluecadet/launchpad/edit/develop/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 Bluecadet'
    }
  }
})
