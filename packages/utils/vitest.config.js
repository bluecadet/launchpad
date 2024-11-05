/// <reference types="@bluecadet/launchpad-testing/vitest.d.ts" />

import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		environment: 'node',
		setupFiles: '@bluecadet/launchpad-testing/setup.js'
	}
});
