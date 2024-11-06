import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		environment: 'node',
		setupFiles: '@bluecadet/launchpad-testing/setup.ts',
		server: {
			deps: {
				// inline these deps so that they use the fs mocks
				inline: ['glob', 'path-scurry']
			}
		}
	}
});
