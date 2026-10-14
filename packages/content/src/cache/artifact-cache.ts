import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FilesystemIdentity } from "../utils/filesystem-identity.js";
import {
	contentKey,
	type Fingerprint,
	fingerprint,
	InputFingerprints,
	type JsonValue,
	OutputClaims,
	resolveOutput,
	safeOutput,
	UnsafeOutputError,
	verifyFingerprint,
} from "./fingerprints.js";
import { type ArtifactKind, type ArtifactRecord, SqliteStore } from "./sqlite-store.js";

export type { JsonValue } from "./fingerprints.js";
export type { ArtifactRecord } from "./sqlite-store.js";

export type RootResolver = (sourceId: string) => string;
export type ArtifactCacheOptions = {
	databasePath: string;
	previousRoot: (sourceId: string) => string | undefined;
	stagedRoot: RootResolver;
	enabled?: boolean;
	warn?: (message: string, error?: unknown) => void;
};
export type DerivedArtifact = {
	sourceId: string;
	namespace: string;
	version: string;
	inputs: readonly string[];
	options: JsonValue;
	outputs: readonly string[];
	generate: () => Promise<void>;
};
export type HttpArtifact = { sourceId: string; key: string; outputPath: string };
export type ArtifactResult = { reused: boolean };
export type OutputClaim = { sourceId: string; key: string; outputs: readonly string[] };

/** Run-scoped artifact operations; publication and database ownership stay with Launchpad. */
export interface ArtifactCacheCapability {
	readonly available: boolean;
	derive(artifact: DerivedArtifact): Promise<ArtifactResult>;
	claimOutputs(artifact: OutputClaim): Promise<void>;
	/** Returns the validated absolute staged destination reserved for this HTTP artifact. */
	claimHttp(artifact: HttpArtifact): Promise<string>;
	lookupHttp(
		artifact: HttpArtifact,
	): Promise<{ record: ArtifactRecord; filePath: string } | undefined>;
	reuseHttp(artifact: HttpArtifact): Promise<boolean>;
	storeHttp(artifact: HttpArtifact & { metadata: JsonValue }): Promise<void>;
}

export class ArtifactCacheError extends Error {
	constructor(
		readonly code:
			| "unavailable"
			| "output-conflict"
			| "publication"
			| "invalid-artifact"
			| "generation",
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "ArtifactCacheError";
	}
}

/** One project database, one instance per run, no stored blobs. */
export class ArtifactCache implements ArtifactCacheCapability {
	private readonly pending = new Map<string, ArtifactRecord>();
	private readonly claims = new Map<string, string>();
	private readonly work = new Map<string, Promise<ArtifactResult>>();
	private readonly activeTasks = new Set<Promise<unknown>>();
	private readonly inputFingerprints = new InputFingerprints();
	private readonly outputClaims = new OutputClaims();
	private readonly filesystemIdentity = new FilesystemIdentity();
	private acceptingGeneration = true;
	private generationFailure: { cause: unknown } | undefined;
	private readonly publishing = new Set<string>();
	private publicationStarted = false;
	private ended = false;

	constructor(
		private readonly options: ArtifactCacheOptions,
		private store: SqliteStore | undefined,
	) {}

	get available(): boolean {
		return this.store !== undefined;
	}

	derive(artifact: DerivedArtifact): Promise<ArtifactResult> {
		return this.track(() => this.deriveArtifact(artifact), true);
	}

	private async deriveArtifact(artifact: DerivedArtifact): Promise<ArtifactResult> {
		this.assertActive();
		if (artifact.outputs.length === 0) {
			throw new ArtifactCacheError("invalid-artifact", "An artifact must declare an output");
		}
		const root = this.options.stagedRoot(artifact.sourceId);
		const outputs = artifact.outputs.map((output) =>
			path.relative(root, resolveOutput(root, output)),
		);
		// Validate source-root boundaries before canonicalizing allowed ancestor aliases.
		const destinations = await Promise.all(
			outputs.map(async (output) => ({ output, destination: await safeOutput(root, output) })),
		);
		const [inputIdentities, outputIdentities] = await Promise.all([
			Promise.all(artifact.inputs.map((input) => this.filesystemIdentity.resolve(input))),
			Promise.all(
				destinations.map(async ({ output, destination }) => ({
					output,
					identity: await this.filesystemIdentity.resolve(destination),
				})),
			),
		]);
		const inputs = new Set(inputIdentities);
		const distinctOutputs = outputIdentities
			.filter(({ identity }) => !inputs.has(identity))
			.map(({ output }) => output);
		if (distinctOutputs.length !== outputs.length) {
			// Only intentional downstream mutations are exempt from ownership checks.
			const key = contentKey({
				namespace: artifact.namespace,
				version: artifact.version,
				inputs: inputIdentities,
				options: z.json().parse(artifact.options),
				outputs: outputIdentities.map(({ identity }) => identity),
			});
			await this.claim(
				artifact.sourceId,
				distinctOutputs,
				JSON.stringify([artifact.sourceId, "in-place", key]),
			);
			await artifact.generate();
			return { reused: false };
		}
		const inputHashes: string[] = [];
		for (const input of artifact.inputs) {
			const value = await this.inputFingerprints.read(input);
			if (!value)
				throw new ArtifactCacheError("invalid-artifact", `Missing artifact input: ${input}`);
			inputHashes.push(value.sha256);
		}
		const key = contentKey({
			namespace: artifact.namespace,
			version: artifact.version,
			inputs: inputHashes,
			options: z.json().parse(artifact.options),
			outputs,
		});
		const identity = this.identity(artifact.sourceId, key, "derived");
		await this.claim(artifact.sourceId, outputs, identity);
		const existing = this.work.get(identity);
		if (existing) return existing;
		const operation = this.generateDerived(artifact, key, outputs, inputHashes);
		this.work.set(identity, operation);
		try {
			return await operation;
		} finally {
			this.work.delete(identity);
		}
	}

	/** Metadata only: callers must not treat this as proof the output exists. */
	async lookupRecord(
		sourceId: string,
		key: string,
		kind: ArtifactKind,
	): Promise<ArtifactRecord | undefined> {
		this.assertActive();
		try {
			return this.store?.lookup(sourceId, key, kind);
		} catch (error) {
			this.disable(error);
			return undefined;
		}
	}

	lookupHttp(
		artifact: HttpArtifact,
	): Promise<{ record: ArtifactRecord; filePath: string } | undefined> {
		return this.track(() => this.lookupHttpArtifact(artifact));
	}

	private async lookupHttpArtifact(
		artifact: HttpArtifact,
	): Promise<{ record: ArtifactRecord; filePath: string } | undefined> {
		const record = await this.lookupRecord(artifact.sourceId, artifact.key, "http");
		if (!record || !this.sameOutputs(record, [artifact.outputPath])) return undefined;
		const verified = await this.verifyPrevious(record);
		const root = this.options.previousRoot(artifact.sourceId);
		return verified && root
			? { record: verified, filePath: resolveOutput(root, artifact.outputPath) }
			: undefined;
	}

	/** Reserve distinct outputs for an uncached custom operation before it writes. */
	claimOutputs(artifact: OutputClaim): Promise<void> {
		return this.track(
			() =>
				this.claim(
					artifact.sourceId,
					artifact.outputs,
					JSON.stringify([artifact.sourceId, "custom", artifact.key]),
				),
			true,
		);
	}

	/** Claim before network writes, even when HTTP policy will not permit storing a record. */
	claimHttp(artifact: HttpArtifact): Promise<string> {
		return this.track(() => this.claimHttpOutput(artifact), true);
	}

	private async claimHttpOutput(artifact: HttpArtifact): Promise<string> {
		await this.claim(
			artifact.sourceId,
			[artifact.outputPath],
			this.identity(artifact.sourceId, artifact.key, "http"),
		);
		return safeOutput(this.options.stagedRoot(artifact.sourceId), artifact.outputPath);
	}

	reuseHttp(artifact: HttpArtifact): Promise<boolean> {
		return this.track(() => this.reuseHttpArtifact(artifact), true);
	}

	private async reuseHttpArtifact(artifact: HttpArtifact): Promise<boolean> {
		await this.claimHttpOutput(artifact);
		const cached = await this.lookupHttp(artifact);
		if (!cached) return false;
		return this.restore(cached.record);
	}

	storeHttp(artifact: HttpArtifact & { metadata: JsonValue }): Promise<void> {
		return this.track(() => this.storeHttpArtifact(artifact), true);
	}

	private async storeHttpArtifact(artifact: HttpArtifact & { metadata: JsonValue }): Promise<void> {
		await this.claimHttpOutput(artifact);
		const record = await this.capture(
			artifact.sourceId,
			artifact.key,
			"http",
			[artifact.outputPath],
			z.json().parse(artifact.metadata),
		);
		this.remember(record);
	}

	/** Freeze writes and drain accepted work BEFORE journaling or filesystem publication. */
	async beginPublication(sourceIds: readonly string[]): Promise<void> {
		this.assertActive();
		this.acceptingGeneration = false;
		const sources = [...sourceIds];
		await Promise.allSettled([...this.activeTasks]);
		this.assertActive();
		this.assertGenerationSucceeded();
		const store = this.requireStore();
		try {
			store.beginPublication(sources);
			this.publicationStarted = true;
			for (const sourceId of sources) this.publishing.add(sourceId);
		} catch (error) {
			this.disable(error);
			throw this.unavailable(error);
		}
	}

	/** Only captured bytes surviving downstream transforms are eligible for durable records. */
	commitPublication(finalRoot: RootResolver): Promise<void> {
		return this.track(() => this.commitArtifactPublication(finalRoot));
	}

	private async commitArtifactPublication(finalRoot: RootResolver): Promise<void> {
		this.assertActive();
		const store = this.requireStore();
		if (!this.publicationStarted) {
			throw new ArtifactCacheError(
				"publication",
				"beginPublication must succeed before committing artifacts",
			);
		}
		this.assertGenerationSucceeded();
		const records: ArtifactRecord[] = [];
		for (const record of this.pending.values()) {
			if (!this.publishing.has(record.sourceId)) continue;
			const verified = await this.verifyFinal(record, finalRoot(record.sourceId));
			if (verified) records.push(verified);
		}
		this.assertActive();
		try {
			store.commitPublication([...this.publishing], records);
			this.pending.clear();
			this.publishing.clear();
			this.ended = true;
		} catch (error) {
			this.disable(error);
			throw this.unavailable(error);
		}
	}

	async invalidate(sourceIds: readonly string[]): Promise<void> {
		this.assertActive();
		const store = this.requireStore();
		try {
			store.invalidate(sourceIds);
			for (const [identity, record] of this.pending) {
				if (sourceIds.includes(record.sourceId)) this.pending.delete(identity);
			}
		} catch (error) {
			this.disable(error);
			throw this.unavailable(error);
		}
	}

	/** Drain accepted work before cleanup; begun unsafe markers remain intact. */
	async abort(): Promise<void> {
		this.ended = true;
		await Promise.allSettled([...this.activeTasks]);
		this.pending.clear();
		this.work.clear();
		this.claims.clear();
	}

	async close(): Promise<void> {
		await this.abort();
		this.store?.close();
		this.store = undefined;
	}

	private async generateDerived(
		artifact: DerivedArtifact,
		key: string,
		outputs: string[],
		inputHashes: readonly string[],
	): Promise<ArtifactResult> {
		const identity = this.identity(artifact.sourceId, key, "derived");
		const completed = this.pending.get(identity);
		if (completed) {
			const verified = await this.verifyFinal(
				completed,
				this.options.stagedRoot(artifact.sourceId),
			);
			if (verified) {
				this.remember(verified);
				return { reused: true };
			}
			this.pending.delete(identity);
		}
		const record = await this.lookupRecord(artifact.sourceId, key, "derived");
		if (record && this.sameOutputs(record, outputs) && (await this.restore(record)))
			return { reused: true };
		await artifact.generate();
		const captured = await this.capture(artifact.sourceId, key, "derived", outputs, null);
		let unchanged = true;
		for (const [index, input] of artifact.inputs.entries()) {
			const actual = await this.inputFingerprints.read(input);
			if (!actual)
				throw new ArtifactCacheError("invalid-artifact", `Missing artifact input: ${input}`);
			if (actual.sha256 !== inputHashes[index]) unchanged = false;
		}
		if (unchanged) this.remember(captured);
		return { reused: false };
	}

	private async capture(
		sourceId: string,
		key: string,
		kind: ArtifactKind,
		outputs: readonly string[],
		metadata: JsonValue,
	): Promise<ArtifactRecord> {
		const captured: ArtifactRecord["outputs"] = [];
		for (const output of outputs) {
			const value = await fingerprint(await safeOutput(this.options.stagedRoot(sourceId), output));
			if (!value)
				throw new ArtifactCacheError(
					"invalid-artifact",
					`Missing or unstable artifact output: ${output}`,
				);
			captured.push({ path: output, fingerprint: value });
		}
		return { sourceId, key, kind, outputs: captured, metadata };
	}

	private async verifyPrevious(record: ArtifactRecord): Promise<ArtifactRecord | undefined> {
		const root = this.options.previousRoot(record.sourceId);
		if (!root) return undefined;
		const outputs: ArtifactRecord["outputs"] = [];
		for (const output of record.outputs) {
			let actual: Fingerprint | undefined;
			try {
				actual = await verifyFingerprint(await safeOutput(root, output.path), output.fingerprint);
			} catch (error) {
				if (error instanceof UnsafeOutputError) return undefined;
				throw error;
			}
			if (!actual) return undefined;
			outputs.push({ path: output.path, fingerprint: actual });
		}
		return { ...record, outputs };
	}

	private async restore(record: ArtifactRecord): Promise<boolean> {
		const verified = await this.verifyPrevious(record);
		const previousRoot = this.options.previousRoot(record.sourceId);
		if (!verified || !previousRoot) return false;
		for (const output of verified.outputs) {
			const destination = await safeOutput(this.options.stagedRoot(record.sourceId), output.path);
			await mkdir(path.dirname(destination), { recursive: true });
			await copyFile(resolveOutput(previousRoot, output.path), destination);
		}
		const staged = await this.capture(
			record.sourceId,
			record.key,
			record.kind,
			verified.outputs.map((output) => output.path),
			record.metadata,
		);
		if (
			staged.outputs.some(
				(output, index) =>
					output.fingerprint.sha256 !== verified.outputs[index]?.fingerprint.sha256,
			)
		)
			return false;
		this.remember(staged);
		return true;
	}

	private async verifyFinal(
		record: ArtifactRecord,
		root: string,
	): Promise<ArtifactRecord | undefined> {
		const outputs: ArtifactRecord["outputs"] = [];
		for (const output of record.outputs) {
			// Always hash: a downstream write may preserve size and timestamps.
			let actual: Fingerprint | undefined;
			try {
				actual = await fingerprint(await safeOutput(root, output.path));
			} catch (error) {
				if (error instanceof UnsafeOutputError) return undefined;
				throw error;
			}
			if (!actual || actual.sha256 !== output.fingerprint.sha256) return undefined;
			outputs.push({ path: output.path, fingerprint: actual });
		}
		return { ...record, outputs };
	}

	private remember(record: ArtifactRecord): void {
		if (!this.ended)
			this.pending.set(this.identity(record.sourceId, record.key, record.kind), record);
	}

	private identity(sourceId: string, key: string, kind: ArtifactKind): string {
		return JSON.stringify([sourceId, kind, key]);
	}

	private sameOutputs(record: ArtifactRecord, requested: readonly string[]): boolean {
		const root = this.options.stagedRoot(record.sourceId);
		return (
			record.outputs.length === requested.length &&
			record.outputs.every((output, index) => {
				const expected = requested[index];
				return (
					expected !== undefined &&
					resolveOutput(root, output.path) === resolveOutput(root, expected)
				);
			})
		);
	}

	private async claim(
		sourceId: string,
		outputs: readonly string[],
		identity: string,
	): Promise<void> {
		const destinations = await Promise.all(
			outputs.map((output) => this.outputClaims.resolve(this.options.stagedRoot(sourceId), output)),
		);
		if (new Set(destinations).size !== destinations.length) {
			throw new ArtifactCacheError("invalid-artifact", "Artifact outputs alias one another");
		}
		for (const destination of destinations) {
			const owner = this.claims.get(destination);
			if (owner && owner !== identity) {
				throw new ArtifactCacheError(
					"output-conflict",
					`Different artifacts claim output: ${destination}`,
				);
			}
		}
		for (const destination of destinations) this.claims.set(destination, identity);
	}

	private track<T>(operation: () => Promise<T>, generation = false): Promise<T> {
		let accepted = false;
		let task: Promise<T>;
		try {
			this.assertActive();
			if (generation && !this.acceptingGeneration) {
				throw new ArtifactCacheError(
					"publication",
					"Artifact generation is frozen for publication",
				);
			}
			accepted = true;
			task = Promise.resolve().then(operation);
		} catch (error) {
			task = Promise.reject(error);
		}
		this.activeTasks.add(task);
		// Observe the exact promise returned to callers, including fire-and-forget users.
		void task.then(
			() => {
				this.activeTasks.delete(task);
			},
			(error: unknown) => {
				this.activeTasks.delete(task);
				if (generation && accepted) this.generationFailure ??= { cause: error };
			},
		);
		return task;
	}

	private assertGenerationSucceeded(): void {
		if (this.generationFailure) {
			throw new ArtifactCacheError(
				"generation",
				"Artifact generation failed; publication is unsafe",
				this.generationFailure,
			);
		}
	}

	private assertActive(): void {
		if (this.ended) throw new ArtifactCacheError("publication", "Artifact cache run has ended");
	}

	private requireStore(): SqliteStore {
		if (!this.store) throw this.unavailable();
		return this.store;
	}

	private unavailable(cause?: unknown): ArtifactCacheError {
		return new ArtifactCacheError(
			"unavailable",
			"Artifact cache unavailable: establish an external durable safety marker before publishing",
			{ cause },
		);
	}

	private disable(error: unknown): void {
		const store = this.store;
		this.store = undefined;
		try {
			store?.close();
		} catch {
			/* Already unusable; preserve the original error for the warning. */
		}
		this.options.warn?.(
			"Artifact cache unavailable; continuing uncached. Publication requires an external durable safety marker.",
			error,
		);
	}
}

export async function createArtifactCache(options: ArtifactCacheOptions): Promise<ArtifactCache> {
	if (options.enabled === false) return new ArtifactCache(options, undefined);
	try {
		return new ArtifactCache(options, await SqliteStore.open(options.databasePath));
	} catch (error) {
		options.warn?.(
			"Artifact cache unavailable; continuing uncached. Publication requires an external durable safety marker.",
			error,
		);
		return new ArtifactCache(options, undefined);
	}
}
