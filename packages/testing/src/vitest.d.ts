import "vitest";

interface CustomMatchers<R = unknown> {
	toBeOk: () => R;
	toBeErr: () => R;
	toMatchPath: (expected: string) => R;
}

declare module "vitest" {
	// biome-ignore lint/suspicious/noExplicitAny: following vitest recommended pattern
	interface Assertion<T = any> extends CustomMatchers<T> {}
	interface AsymmetricMatchersContaining extends CustomMatchers {}
}
