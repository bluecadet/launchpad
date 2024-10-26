import { defineConfig, defineProject } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		setupFiles: '@bluecadet/launchpad-testing/setup.js',
		server: {
			deps: {
				// inline these deps so that they use the fs mocks
				inline: ['glob', 'path-scurry']
			}
		}
	}
});
