import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['@bluecadet/launchpad-testing/setup.ts'],
		testTimeout: 15_000,
		hookTimeout: 10_000,
	},
});
