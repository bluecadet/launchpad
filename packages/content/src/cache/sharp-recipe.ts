import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import type { Sharp } from "sharp";

// Audited against sharp/dist/{constructor,input,composite,operation,output}.cjs 0.35.3.
// Updating Sharp requires auditing this schema and bumping the adapter version.
const ADAPTER_VERSION = 1;
const AUDITED_SHARP_VERSION = "0.35.3";
const OPTION_KEYS = new Set(
	"topOffsetPre leftOffsetPre widthPre heightPre topOffsetPost leftOffsetPost widthPost heightPost width height canvas position resizeBackground angle rotationAngle rotationBackground rotateBefore orientBefore flip flop extendTop extendBottom extendLeft extendRight extendBackground extendWith withoutEnlargement withoutReduction affineMatrix affineBackground affineIdx affineIdy affineOdx affineOdy affineInterpolator kernel fastShrinkOnLoad tint flatten flattenBackground unflatten negate negateAlpha medianSize blurSigma precision minAmpl sharpenSigma sharpenM1 sharpenM2 sharpenX1 sharpenY2 sharpenY3 threshold thresholdGrayscale trimBackground trimThreshold trimLineArt trimMargin dilateWidth erodeWidth gamma gammaOut greyscale normalise normaliseLower normaliseUpper claheWidth claheHeight claheMaxSlope brightness saturation hue lightness booleanBufferIn booleanFileIn joinChannelIn extractChannel removeAlpha ensureAlpha colourspace colourspacePipeline composite fileOut formatOut streamOut typedArrayOut keepMetadata withMetadataOrientation withMetadataDensity withIccProfile withExif withExifMerge withXmp keepGainMap withGainMap resolveWithObject loop delay jpegQuality jpegProgressive jpegChromaSubsampling jpegTrellisQuantisation jpegOvershootDeringing jpegOptimiseScans jpegOptimiseCoding jpegQuantisationTable pngProgressive pngCompressionLevel pngAdaptiveFiltering pngPalette pngQuality pngEffort pngBitdepth pngDither jp2Quality jp2TileHeight jp2TileWidth jp2Lossless jp2ChromaSubsampling webpQuality webpAlphaQuality webpLossless webpNearLossless webpSmartSubsample webpSmartDeblock webpPreset webpEffort webpMinSize webpMixed webpExact gifBitdepth gifEffort gifDither gifInterFrameMaxError gifInterPaletteMaxError gifKeepDuplicateFrames gifReuse gifProgressive tiffQuality tiffCompression tiffBigtiff tiffPredictor tiffPyramid tiffMiniswhite tiffBitdepth tiffTile tiffTileHeight tiffTileWidth tiffXres tiffYres tiffResolutionUnit heifQuality heifLossless heifCompression heifEffort heifChromaSubsampling heifBitdepth heifTune jxlDistance jxlDecodingTier jxlEffort jxlLossless rawDepth tileSize tileOverlap tileContainer tileLayout tileFormat tileDepth tileAngle tileSkipBlanks tileBackground tileCentre tileId tileBasename timeoutSeconds linearA linearB pdfBackground input boolean booleanOp bandBoolOp join joining convKernel recombMatrix".split(
		/\s+/,
	),
);
const INPUT_KEYS = new Set(
	"autoOrient failOn limitInputPixels limitInputChannels ignoreIcc unlimited sequentialRead file buffer density page pages rawChannels rawDepth rawHeight rawPageHeight rawPremultiplied rawWidth createBackground createChannels createHeight createPageHeight createWidth createNoiseMean createNoiseSigma createNoiseType joinAcross joinAnimated joinBackground joinHalign joinShim joinValign jp2Oneshot openSlideLevel pdfBackground svgHighBitdepth svgStylesheet textAlign textDpi textFont textFontfile textHeight textJustify textRgba textSpacing textValue textWidth textWrap tiffSubifd".split(
		/\s+/,
	),
);
const COMPOSITE_KEYS = new Set([
	"input",
	"blend",
	"tile",
	"left",
	"top",
	"hasOffset",
	"gravity",
	"premultiplied",
]);
const RUNTIME_KEYS = new Set(["debuglog", "queueListener"]);
const BUILTIN_ICC_PROFILES = new Set(["srgb", "p3", "cmyk"]);

type CanonicalValue = null | boolean | number | string | CanonicalValue[];

export type SharpRecipe = {
	/** Original paths define identity; execution may read immutable batch snapshots. */
	dependencies: readonly string[];
	loaderInputs: readonly string[];
	createPipeline: (snapshots: ReadonlyMap<string, string>) => Sharp;
} & ({ cacheable: true; fingerprint: string } | { cacheable: false; reason: string });

class UnsupportedRecipe extends Error {}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
	const result = optionalRecord(value);
	if (!result) throw new UnsupportedRecipe(`Unsupported Sharp ${label} schema`);
	return result;
}

function knownKeys(value: Record<string, unknown>, keys: Set<string>, label: string) {
	for (const key of Object.keys(value)) {
		if (!keys.has(key)) throw new UnsupportedRecipe(`Unknown Sharp ${label} option '${key}'`);
	}
}

// Tagged values avoid ambiguity between buffer bytes, arrays, and user metadata objects.
// Objects sort recursively; arrays retain their order. Functions are never fingerprinted.
function canonical(value: unknown): CanonicalValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (value instanceof Uint8Array) {
		return ["bytes", Buffer.from(value).toString("base64")];
	}
	if (Array.isArray(value)) return ["array", value.map(canonical)];
	if (
		typeof value !== "object" ||
		value === null ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new UnsupportedRecipe("Sharp recipe contains an unsupported value or function");
	}
	return [
		"object",
		Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, entry]) => [key, canonical(entry)]),
	];
}

function requireLocalFile(value: unknown) {
	if (typeof value !== "string" || value === "")
		throw new UnsupportedRecipe("Unresolved Sharp resource");
	if (/^[a-z][a-z\d+.-]*:\/\//i.test(value))
		throw new UnsupportedRecipe("Non-local Sharp resource");
}

function inspectInput(value: unknown, streamed = false) {
	const input = record(value, "input");
	knownKeys(input, INPUT_KEYS, "input");
	if (Object.keys(input).some((key) => key.startsWith("text") || key.startsWith("createNoise"))) {
		throw new UnsupportedRecipe("Sharp text/fonts and nondeterministic noise are not cacheable");
	}
	if (input.svgStylesheet !== undefined || input.openSlideLevel !== undefined) {
		throw new UnsupportedRecipe("Sharp loader has unresolved external dependencies");
	}
	if (input.file !== undefined) requireLocalFile(input.file);
	if (input.buffer instanceof Uint8Array && !input.rawWidth && !isRaster(input.buffer)) {
		throw new UnsupportedRecipe("Sharp SVG or unresolved buffer loader dependencies");
	}
	if (Array.isArray(input.buffer) && (!streamed || input.buffer.length !== 0)) {
		throw new UnsupportedRecipe("Sharp input has already received streaming data");
	}
}

function cloneOptions(value: unknown): unknown {
	// Callbacks disable fingerprinting but retain their normal uncached behavior.
	// All mutable option data is detached, including buffers and streamed input arrays.
	if (typeof value === "function") return value;
	if (Array.isArray(value)) return value.map(cloneOptions);
	if (
		typeof value === "object" &&
		value !== null &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, cloneOptions(entry)]),
		);
	}
	return structuredClone(value);
}

type FileReference = {
	options: Record<string, unknown>;
	key: string;
	filename: string;
	loader: boolean;
};

/** These are Sharp's explicit file-bearing slots, including uncached text loaders. */
function fileReferences(options: Record<string, unknown>): FileReference[] {
	const references: FileReference[] = [];
	const add = (options: Record<string, unknown>, key: string, loader: boolean) => {
		const value = options[key];
		if (typeof value !== "string" || value === "" || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return;
		references.push({ options, key, filename: path.resolve(value), loader });
	};
	const input = (value: unknown) => {
		const descriptor = optionalRecord(value);
		if (!descriptor) return;
		add(descriptor, "file", true);
		add(descriptor, "textFontfile", false);
	};
	input(options.input);
	if (Array.isArray(options.joinChannelIn)) options.joinChannelIn.forEach(input);
	if (options.boolean !== undefined) input(options.boolean);
	if (Array.isArray(options.composite)) {
		for (const entry of options.composite) input(optionalRecord(entry)?.input);
	}
	add(options, "booleanFileIn", true);
	if (
		typeof options.withIccProfile === "string" &&
		!BUILTIN_ICC_PROFILES.has(options.withIccProfile)
	) {
		add(options, "withIccProfile", false);
	}
	return references;
}

/** Analyze one resolved template per batch; construct execution pipelines only on misses. */
export function prepareSharpRecipe(
	transform: Sharp,
	versions: Readonly<Record<string, string>>,
	createPipeline: () => Sharp,
	cacheKey?: string,
): SharpRecipe {
	const descriptor = Object.getOwnPropertyDescriptor(transform, "options");
	const snapshot = record(cloneOptions(descriptor?.value), "options");
	const references = fileReferences(snapshot);
	const dependencies = [...new Set(references.map(({ filename }) => filename))].sort();
	const prepared = {
		dependencies,
		loaderInputs: [
			...new Set(references.filter(({ loader }) => loader).map(({ filename }) => filename)),
		],
		createPipeline(snapshots: ReadonlyMap<string, string>): Sharp {
			const pipeline = createPipeline();
			const options = record(cloneOptions(snapshot), "cloned options");
			for (const reference of fileReferences(options)) {
				const replacement = snapshots.get(reference.filename);
				if (replacement) reference.options[reference.key] = replacement;
			}
			Object.defineProperty(pipeline, "options", { ...descriptor, value: options });
			return pipeline;
		},
	};
	if (versions.sharp !== AUDITED_SHARP_VERSION) {
		return { ...prepared, cacheable: false, reason: `Unaudited Sharp version '${versions.sharp}'` };
	}
	try {
		const options = Object.fromEntries(
			Object.entries(snapshot).filter(([key]) => !RUNTIME_KEYS.has(key)),
		);
		knownKeys(options, OPTION_KEYS, "pipeline");
		if (
			typeof options.width !== "number" ||
			typeof options.height !== "number" ||
			typeof options.formatOut !== "string" ||
			!Array.isArray(options.composite) ||
			!Array.isArray(options.joinChannelIn)
		) {
			throw new UnsupportedRecipe("Unsupported Sharp pipeline schema");
		}
		if (options.fileOut !== "" || options.streamOut !== false || options.joining) {
			throw new UnsupportedRecipe("Sharp recipe is not an unstarted streaming pipeline");
		}
		inspectInput(options.input, true);
		for (const input of options.joinChannelIn) inspectInput(input);
		if (options.boolean !== undefined) inspectInput(options.boolean);
		if (options.booleanFileIn) requireLocalFile(options.booleanFileIn);
		for (const entry of options.composite) {
			const composite = record(entry, "composite");
			knownKeys(composite, COMPOSITE_KEYS, "composite");
			inspectInput(composite.input);
		}
		if (options.booleanBufferIn instanceof Uint8Array && !isRaster(options.booleanBufferIn)) {
			throw new UnsupportedRecipe("Sharp boolean buffer uses an unsupported loader");
		}
		if (
			options.withIccProfile &&
			(typeof options.withIccProfile !== "string" ||
				!BUILTIN_ICC_PROFILES.has(options.withIccProfile))
		) {
			requireLocalFile(options.withIccProfile);
		}
		const fingerprint = createHash("sha256")
			.update(
				JSON.stringify(
					canonical({ adapter: ADAPTER_VERSION, options, versions, cacheKey: cacheKey ?? null }),
				),
			)
			.digest("hex");
		return { ...prepared, cacheable: true, fingerprint };
	} catch (error) {
		if (!(error instanceof UnsupportedRecipe)) throw error;
		return { ...prepared, cacheable: false, reason: error.message };
	}
}

// Only self-contained raster loaders are trusted. SVG/PDF/text can resolve fonts,
// stylesheets and local resources outside the pipeline's explicit input descriptors.
function isRaster(bytes: Uint8Array): boolean {
	const header = Buffer.from(bytes.subarray(0, 32));
	return (
		header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
		header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
		/^GIF8[79]a/.test(header.toString("ascii")) ||
		(header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") ||
		["II*\u0000", "MM\u0000*", "II+\u0000", "MM\u0000+"].includes(
			header.toString("latin1", 0, 4),
		) ||
		(header.toString("ascii", 4, 8) === "ftyp" &&
			/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(header.toString("ascii", 8, 12))) ||
		header.subarray(0, 12).equals(Buffer.from([0, 0, 0, 12, 106, 80, 32, 32, 13, 10, 135, 10])) ||
		header.subarray(0, 4).equals(Buffer.from([0xff, 0x4f, 0xff, 0x51])) ||
		header.subarray(0, 2).equals(Buffer.from([0xff, 0x0a])) ||
		header.subarray(0, 12).equals(Buffer.from([0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10]))
	);
}

/** Missing files deliberately throw; an unsupported loader merely disables reuse. */
export async function sharpInputDiagnostic(inputPaths: string[]): Promise<string | undefined> {
	for (const inputPath of inputPaths) {
		const file = await open(inputPath, "r");
		try {
			const header = Buffer.alloc(32);
			const { bytesRead } = await file.read(header, 0, header.length, 0);
			if (!isRaster(header.subarray(0, bytesRead))) {
				return `Sharp input '${inputPath}' uses an unsupported or externally-dependent loader`;
			}
		} finally {
			await file.close();
		}
	}
	return undefined;
}
