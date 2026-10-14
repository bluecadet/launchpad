import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { fingerprintSchema, resolveOutput } from "./fingerprints.js";

const outputPathSchema = z.string().refine((output) => {
	try {
		resolveOutput(path.resolve(".artifact-cache-source"), output);
		return true;
	} catch {
		return false;
	}
});

const artifactRecordSchema = z.object({
	sourceId: z.string(),
	key: z.string(),
	kind: z.enum(["derived", "http"]),
	outputs: z.array(z.object({ path: outputPathSchema, fingerprint: fingerprintSchema })).min(1),
	metadata: z.json(),
});
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type ArtifactKind = ArtifactRecord["kind"];

/** SQLite owns transactions and validation, never file ownership or publication policy. */
export class SqliteStore {
	private constructor(private readonly database: DatabaseSync) {}

	static async open(databasePath: string): Promise<SqliteStore> {
		await mkdir(path.dirname(databasePath), { recursive: true });
		const database = new DatabaseSync(databasePath);
		try {
			database.exec(`
				PRAGMA busy_timeout = 5000;
				PRAGMA journal_mode = WAL;
				PRAGMA synchronous = FULL;
				CREATE TABLE IF NOT EXISTS artifacts (
					source_id TEXT NOT NULL,
					kind TEXT NOT NULL,
					artifact_key TEXT NOT NULL,
					record_json TEXT NOT NULL,
					PRIMARY KEY (source_id, kind, artifact_key)
				);
				CREATE TABLE IF NOT EXISTS unsafe_sources (source_id TEXT PRIMARY KEY);
			`);
			return new SqliteStore(database);
		} catch (error) {
			database.close();
			throw error;
		}
	}

	lookup(sourceId: string, key: string, kind: ArtifactKind): ArtifactRecord | undefined {
		const row = this.database
			.prepare(`
			SELECT record_json FROM artifacts
			WHERE source_id = ? AND kind = ? AND artifact_key = ?
			AND NOT EXISTS (SELECT 1 FROM unsafe_sources WHERE source_id = ?)
		`)
			.get(sourceId, kind, key, sourceId);
		if (!row || typeof row.record_json !== "string") return undefined;
		let json: unknown;
		try {
			json = JSON.parse(row.record_json);
		} catch {
			return undefined;
		}
		const parsed = artifactRecordSchema.safeParse(json);
		if (!parsed.success) return undefined;
		const record = parsed.data;
		return record.sourceId === sourceId && record.key === key && record.kind === kind
			? record
			: undefined;
	}

	beginPublication(sourceIds: readonly string[]): void {
		this.transaction(() => {
			const insert = this.database.prepare("INSERT OR IGNORE INTO unsafe_sources VALUES (?)");
			for (const sourceId of sourceIds) insert.run(sourceId);
		});
	}

	commitPublication(sourceIds: readonly string[], records: readonly ArtifactRecord[]): void {
		this.transaction(() => {
			const remove = this.database.prepare("DELETE FROM artifacts WHERE source_id = ?");
			const clear = this.database.prepare("DELETE FROM unsafe_sources WHERE source_id = ?");
			for (const sourceId of sourceIds) {
				remove.run(sourceId);
				clear.run(sourceId);
			}
			const insert = this.database.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?)");
			for (const record of records) {
				insert.run(record.sourceId, record.kind, record.key, JSON.stringify(record));
			}
		});
	}

	invalidate(sourceIds: readonly string[]): void {
		this.transaction(() => {
			const remove = this.database.prepare("DELETE FROM artifacts WHERE source_id = ?");
			for (const sourceId of sourceIds) remove.run(sourceId);
		});
	}

	close(): void {
		this.database.close();
	}

	private transaction(operation: () => void): void {
		this.database.exec("BEGIN IMMEDIATE");
		try {
			operation();
			this.database.exec("COMMIT");
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
	}
}
