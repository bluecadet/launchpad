import { vi } from 'vitest';
import { fs } from 'memfs';

vi.mock('fs', () => ({
	...fs,
	default: fs
}));

vi.mock('fs/promises', () => ({
	...fs.promises,
	default: fs.promises
}));

vi.mock('node:fs', () => ({
	...fs,
	default: fs
}));

vi.mock('node:fs/promises', () => ({
	...fs.promises,
	default: fs.promises
}));
