import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['@bluecadet/launchpad-testing/setup.ts'],
	},
});
