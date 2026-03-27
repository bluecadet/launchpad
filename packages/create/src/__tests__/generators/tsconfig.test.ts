import { describe, expect, it } from "vitest";
import { generateTsconfig, validateAndPatchTsconfig } from "../../generators/tsconfig.js";

describe("generateTsconfig", () => {
	it("produces valid JSON", () => {
		expect(() => JSON.parse(generateTsconfig())).not.toThrow();
	});

	it("uses NodeNext module and moduleResolution", () => {
		const tsconfig = JSON.parse(generateTsconfig()) as {
			compilerOptions: Record<string, string>;
		};
		expect(tsconfig.compilerOptions["module"]).toBe("NodeNext");
		expect(tsconfig.compilerOptions["moduleResolution"]).toBe("NodeNext");
	});

	it("enables strict mode", () => {
		const tsconfig = JSON.parse(generateTsconfig()) as {
			compilerOptions: Record<string, boolean>;
		};
		expect(tsconfig.compilerOptions["strict"]).toBe(true);
	});
});

describe("validateAndPatchTsconfig", () => {
	it("returns no warnings for a valid ESM tsconfig", () => {
		const existing = JSON.stringify({
			compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true },
		});
		const { warnings } = validateAndPatchTsconfig(existing);
		expect(warnings).toHaveLength(0);
	});

	it("warns when module is CommonJS", () => {
		const existing = JSON.stringify({
			compilerOptions: { module: "CommonJS" },
		});
		const { warnings } = validateAndPatchTsconfig(existing);
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings[0]).toContain("CommonJS");
	});

	it("silently patches missing esModuleInterop", () => {
		const existing = JSON.stringify({
			compilerOptions: { module: "NodeNext" },
		});
		const { content, warnings } = validateAndPatchTsconfig(existing);
		const tsconfig = JSON.parse(content) as { compilerOptions: Record<string, boolean> };
		expect(tsconfig.compilerOptions["esModuleInterop"]).toBe(true);
		expect(warnings).toHaveLength(0);
	});

	it("does not overwrite existing esModuleInterop: false", () => {
		const existing = JSON.stringify({
			compilerOptions: { module: "NodeNext", esModuleInterop: false },
		});
		const { content } = validateAndPatchTsconfig(existing);
		const tsconfig = JSON.parse(content) as { compilerOptions: Record<string, boolean> };
		expect(tsconfig.compilerOptions["esModuleInterop"]).toBe(false);
	});

	it("returns a warning when JSON is invalid", () => {
		const { warnings, content } = validateAndPatchTsconfig("not valid json");
		expect(warnings.length).toBeGreaterThan(0);
		expect(content).toBe("not valid json");
	});
});
