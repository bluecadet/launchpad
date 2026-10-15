import { core, type z } from "zod";

type Definition = core.$ZodTypes["_zod"]["def"];
type ConfigDocs = {
	inputType?: string;
	defaultLabel?: string;
	propertiesFrom?: "output";
};
type ReferenceNode = {
	type: string;
	optional: boolean;
	defaultLabel?: string;
	description: string;
	children: Map<string, ReferenceNode>;
	objectOnly?: boolean;
};

function configDocs(schema: core.$ZodType): ConfigDocs {
	const metadata = core.globalRegistry.get(schema)?.configDocs;
	if (typeof metadata !== "object" || metadata === null) return {};
	return {
		inputType:
			"inputType" in metadata && typeof metadata.inputType === "string"
				? metadata.inputType
				: undefined,
		defaultLabel:
			"defaultLabel" in metadata && typeof metadata.defaultLabel === "string"
				? metadata.defaultLabel
				: undefined,
		propertiesFrom:
			"propertiesFrom" in metadata && metadata.propertiesFrom === "output" ? "output" : undefined,
	};
}

function joinPath(parent: string, child: string): string {
	if (!parent || child.startsWith("[")) return `${parent}${child}`;
	return `${parent}.${child}`;
}

function unique(values: string[], separator: string): string {
	return [...new Set(values)].join(separator);
}

function node(type: string, children = new Map<string, ReferenceNode>()): ReferenceNode {
	return { type, optional: false, description: "", children };
}

function combinedDefault(
	nodes: ReferenceNode[],
	mode: "union" | "intersection",
): string | undefined {
	const labels = nodes.map((entry) => entry.defaultLabel);
	const defaults = labels.flatMap((label) => (label === undefined ? [] : [label]));
	if (!defaults.length) return undefined;
	// Branch order and validation determine which union default actually applies.
	// Do not parse inputs or imply that every alternative is an effective default.
	if (mode === "union" && new Set(labels).size > 1) return "Branch-dependent";
	return unique(defaults, " / ");
}

/** Merge field views, retaining fields that appear in only one union branch. */
function combine(nodes: ReferenceNode[], mode: "union" | "intersection"): ReferenceNode {
	const children = new Map<string, ReferenceNode>();
	const keys = new Set(nodes.flatMap((entry) => [...entry.children.keys()]));
	for (const key of keys) {
		const variants = nodes.flatMap((entry) => {
			const child = entry.children.get(key);
			return child ? [child] : [];
		});
		const child = combine(variants, mode);
		if (mode === "union" && variants.length < nodes.length) child.optional = true;
		children.set(key, child);
	}
	return {
		type: unique(
			nodes.map((entry) =>
				mode === "intersection" && nodes.length > 1 ? parenthesize(entry.type) : entry.type,
			),
			mode === "union" ? " | " : " & ",
		),
		optional:
			mode === "union"
				? nodes.some((entry) => entry.optional)
				: nodes.every((entry) => entry.optional),
		defaultLabel: combinedDefault(nodes, mode),
		description: unique(nodes.map((entry) => entry.description).filter(Boolean), " / "),
		children,
		objectOnly:
			mode === "union"
				? nodes.every((entry) => entry.objectOnly)
				: nodes.some((entry) => entry.objectOnly),
	};
}

/** Serialize only data, never getters, toJSON methods, or application callbacks. */
function defaultValueLabel(value: unknown, ancestors = new Set<object>()): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "bigint") return `${value}n`;
	if (typeof value !== "object") {
		return typeof value === "function" ? "Function (set configDocs.defaultLabel)" : String(value);
	}
	if (ancestors.has(value)) return "Circular value (set configDocs.defaultLabel)";
	if (
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	) {
		return "Non-JSON value (set configDocs.defaultLabel)";
	}
	const nextAncestors = new Set(ancestors).add(value);
	const entries: string[] = [];
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (!descriptor.enumerable) continue;
		if (!("value" in descriptor)) return "Accessor value (set configDocs.defaultLabel)";
		const label = defaultValueLabel(descriptor.value, nextAncestors);
		entries.push(Array.isArray(value) ? label : `${JSON.stringify(key)}:${label}`);
	}
	return Array.isArray(value) ? `[${entries.join(",")}]` : `{${entries.join(",")}}`;
}

function schemaDefault(definition: core.$ZodDefaultDef | core.$ZodPrefaultDef): string {
	// Reading Zod's accessor (including its default factory) is deliberately allowed
	// for docs builds. No parsing, preprocessing, transforms, or callbacks carried
	// AS default values are executed. A defaultLabel bypasses this accessor entirely.
	return defaultValueLabel(definition.defaultValue);
}

function parenthesize(type: string): string {
	return type.includes(" | ") || type.includes(" & ") ? `(${type})` : type;
}

function unsupported(path: string, kind: string, opaque = false): never {
	const hint = opaque ? '; add .meta({ configDocs: { inputType: "…" } })' : "";
	throw new Error(`Cannot document schema at ${path || "(root)"}: unsupported ${kind}${hint}`);
}

function schemaDefinition(schema: core.$ZodType): Definition {
	// The core definition union gives discriminated narrowing without depending on
	// classic Zod classes. Keep this assertion at the internal API boundary.
	return schema._zod.def as Definition;
}

/** Find the closest label along the same input, without reading default accessors. */
function inheritedDefaultLabel(schema: core.$ZodType): string | undefined {
	const label = configDocs(schema).defaultLabel;
	if (label !== undefined) return label;
	const definition = schemaDefinition(schema);
	switch (definition.type) {
		case "optional":
		case "default":
		case "prefault":
		case "readonly":
		case "nonoptional":
		case "nullable":
			return inheritedDefaultLabel(definition.innerType);
		case "pipe":
			return inheritedDefaultLabel(definition.in);
		default:
			return undefined;
	}
}

function inspect(schema: core.$ZodType, path: string, overrides: ConfigDocs = {}): ReferenceNode {
	const definition = schemaDefinition(schema);
	const local = configDocs(schema);
	const metadata: ConfigDocs = {
		inputType: overrides.inputType ?? local.inputType,
		defaultLabel: overrides.defaultLabel ?? local.defaultLabel,
		propertiesFrom: overrides.propertiesFrom ?? local.propertiesFrom,
	};
	const result = inspectDefinition(definition, path, metadata);
	return {
		...result,
		// Object-property omission is a Zod structural flag, not the same as
		// accepting an explicitly supplied undefined (unknown/void/intersections).
		optional: schema._zod.optin === "optional",
		type: metadata.inputType ?? result.type,
		defaultLabel: metadata.defaultLabel ?? result.defaultLabel,
		description: core.globalRegistry.get(schema)?.description ?? result.description,
	};
}

function inspectDefinition(
	definition: Definition,
	path: string,
	metadata: ConfigDocs,
): ReferenceNode {
	switch (definition.type) {
		case "optional":
			return inspect(definition.innerType, path, metadata);
		case "default":
		case "prefault": {
			const defaultLabel =
				metadata.defaultLabel ??
				inheritedDefaultLabel(definition.innerType) ??
				schemaDefault(definition);
			// Resolve this wrapper first. Its label also suppresses shadowed defaults
			// on the same input, but does not override independent child-field defaults.
			return inspect(definition.innerType, path, { ...metadata, defaultLabel });
		}
		case "readonly":
			return inspect(definition.innerType, path, metadata);
		case "nonoptional":
			return inspect(definition.innerType, path, metadata);
		case "nullable": {
			const inner = inspect(definition.innerType, path, metadata);
			return { ...inner, type: unique([inner.type, "null"], " | "), objectOnly: false };
		}
		case "pipe": {
			const input = inspect(definition.in, path, metadata);
			if (metadata.propertiesFrom !== "output") return input;
			const output = inspect(definition.out, path);
			return { ...input, children: output.children };
		}
		case "object": {
			const children = new Map<string, ReferenceNode>();
			for (const [key, child] of Object.entries(definition.shape)) {
				children.set(key, inspect(child, joinPath(path, key)));
			}
			return { ...node("object", children), objectOnly: true };
		}
		case "array": {
			const element = inspect(definition.element, `${path}[]`);
			const children = new Map(
				[...element.children].map(([key, child]) => [joinPath("[]", key), child]),
			);
			return node(`${parenthesize(element.type)}[]`, children);
		}
		case "record": {
			const key = inspect(definition.keyType, `${path}[key]`);
			const value = inspect(definition.valueType, `${path}[key]`);
			return node(
				`Record<${key.type}, ${value.type}>`,
				new Map([["[key]", { ...value, optional: true }]]),
			);
		}
		case "union":
			return combine(
				definition.options.map((option) => inspect(option, path, metadata)),
				"union",
			);
		case "intersection":
			return combine(
				[inspect(definition.left, path, metadata), inspect(definition.right, path, metadata)],
				"intersection",
			);
		case "promise": {
			const inner = inspect(definition.innerType, path, metadata);
			return {
				...inner,
				type: `Promise<${inner.type}>`,
				defaultLabel: undefined,
				objectOnly: false,
			};
		}
		case "literal":
			return node(
				unique(
					definition.values.map((value) => defaultValueLabel(value)),
					" | ",
				),
			);
		case "enum":
			return node(
				unique(
					core.util.getEnumValues(definition.entries).map((value) => defaultValueLabel(value)),
					" | ",
				),
			);
		case "undefined":
		case "void":
		case "unknown":
		case "string":
		case "number":
		case "boolean":
		case "bigint":
		case "symbol":
		case "null":
		case "never":
			return node(definition.type);
		case "date":
			return node("Date");
		case "nan":
			return node("NaN");
		case "any":
		case "custom":
		case "function":
		case "transform":
			return metadata.inputType !== undefined
				? node(metadata.inputType)
				: unsupported(path, definition.type, true);
		default:
			return unsupported(path, definition.type);
	}
}

export type ConfigReferenceRow = {
	name: string;
	type: string;
	required: boolean;
	defaultValue: string | undefined;
	description: string;
};

/** Whether a row belongs to a property's subtree, without matching similarly named siblings. */
function isDescendant(name: string, property: string): boolean {
	if (property === "(root)") return name !== property;
	return name.startsWith(`${property}.`) || name.startsWith(`${property}[`);
}

/** Select metadata for a handwritten property section, or the full reference as a fallback. */
export function selectConfigReferenceRows(
	rows: readonly ConfigReferenceRow[],
	options: {
		property?: string;
		includeChildren?: boolean;
		exclude?: readonly string[];
	} = {},
): readonly ConfigReferenceRow[] {
	const { property, includeChildren = false, exclude } = options;
	if (property === undefined) {
		if (exclude !== undefined) throw new Error("Configuration exclusions require a property");
		return rows;
	}
	const selected = rows.find((row) => row.name === property);
	if (!selected) throw new Error(`Unknown configuration property: ${property}`);
	if (exclude !== undefined && !includeChildren) {
		throw new Error("Configuration exclusions require includeChildren");
	}
	for (const path of exclude ?? []) {
		if (!isDescendant(path, property) || !rows.some((row) => row.name === path)) {
			throw new Error(
				`Invalid configuration exclusion: ${path} is not a descendant of ${property}`,
			);
		}
	}
	if (!includeChildren) return [selected];
	return [
		selected,
		...rows.filter(
			(row) =>
				isDescendant(row.name, property) &&
				!exclude?.some((path) => row.name === path || isDescendant(row.name, path)),
		),
	];
}

/** Describe accepted configuration input as plain text, without parsing values. */
export function getConfigReferenceRows(
	schema: z.ZodType,
	options: { nested?: boolean } = {},
): ConfigReferenceRow[] {
	const root = inspect(schema, "");
	const rows: ConfigReferenceRow[] = [];
	function append(entry: ReferenceNode, path: string, includeChildren = true): void {
		rows.push({
			name: path,
			type: entry.type,
			required: !entry.optional,
			defaultValue: entry.defaultLabel,
			description: entry.description,
		});
		if (!includeChildren || options.nested === false) return;
		for (const [key, child] of entry.children) append(child, joinPath(path, key));
	}
	if (!root.objectOnly || !root.children.size) append(root, "(root)", false);
	if (root.objectOnly || options.nested !== false) {
		for (const [key, child] of root.children) append(child, key);
	}
	return rows;
}
