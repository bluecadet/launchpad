const BASE_TSCONFIG = {
	compilerOptions: {
		module: "NodeNext",
		moduleResolution: "NodeNext",
		strict: true,
		esModuleInterop: true,
	},
};

export function generateTsconfig(): string {
	return JSON.stringify(BASE_TSCONFIG, null, "\t");
}

export function validateAndPatchTsconfig(existing: string): {
	content: string;
	warnings: string[];
} {
	const warnings: string[] = [];
	let tsconfig: Record<string, unknown>;

	try {
		tsconfig = JSON.parse(existing) as Record<string, unknown>;
	} catch {
		return { content: existing, warnings: ["Could not parse tsconfig.json — leaving unchanged"] };
	}

	const compilerOptions = (tsconfig.compilerOptions as Record<string, unknown> | undefined) ?? {};

	// Warn on CJS module settings
	const moduleValue = compilerOptions.module;
	if (
		typeof moduleValue === "string" &&
		moduleValue.toLowerCase() !== "nodenext" &&
		moduleValue.toLowerCase() !== "node16"
	) {
		warnings.push(
			`tsconfig.json "module" is "${moduleValue}" — Launchpad requires ESM (NodeNext or Node16). Update manually.`,
		);
	}

	// Silently patch missing esModuleInterop
	if (!("esModuleInterop" in compilerOptions)) {
		compilerOptions.esModuleInterop = true;
		tsconfig.compilerOptions = compilerOptions;
	}

	return { content: JSON.stringify(tsconfig, null, "\t"), warnings };
}
