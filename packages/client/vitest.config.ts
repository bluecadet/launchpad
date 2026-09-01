import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		environment: 'node',
		setupFiles: '@bluecadet/launchpad-testing/setup.ts'
	}
});
