import fs from "node:fs/promises";
import path, { resolve } from "node:path";
import { JSONPath } from "jsonpath-plus";
import { Result, ResultAsync, err, errAsync, ok, okAsync } from "neverthrow";
import { z } from "zod";
import { ensureDir } from "./file-utils.js";

export class DataStoreError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "DataStoreError";
	}
}

/**
 * A list containing a combination of namespace ids, and namespace/document id tuples.
 */
export const dataKeysSchema = z
	.array(
		z
			.string()
			.or(z.tuple([z.string()]))
			.or(z.tuple([z.string(), z.string()])),
	)
	.describe("A list containing a combination of namespace ids, and namespace/document id tuples.");

/**
 * A list containing a combination of namespace ids, and namespace/document id tuples.
 */
export type DataKeys = z.infer<typeof dataKeysSchema>;

/**
 * A document represents a single file or resource.
 * It is a proxy for the underlying file, and provides a simple api for updating the file.
 * When the document is updated, a copy of the original file is created with the `.original` suffix.
 */
export abstract class Document<T = unknown> {
	protected _id: string;

	constructor(id: string) {
		this._id = id;
	}

	get id() {
		return this._id;
	}

	/**
	 * Read the document. Should only be used internally. Exposed for testing purposes.
	 * @internal
	 */
	abstract _read(): Promise<unknown>;

	/**
	 * Read the document. Same as {@link _read}, but returns a neverthrow {@link ResultAsync}.
	 * @internal
	 */
	_safeRead(): ResultAsync<unknown, DataStoreError> {
		return ResultAsync.fromPromise(
			this._read(),
			(e) => new DataStoreError(`Error reading document ${this._id}`, { cause: e }),
		);
	}

	/**
	 * Update the document with the given callback.
	 * @param cb A function that takes the current data and returns the new data.
	 */
	abstract update(cb: (data: T) => T | Promise<T>): Promise<void>;

	/**
	 * Update the document with the given callback. Same as {@link update}, but returns a neverthrow {@link ResultAsync}.
	 * @param cb A function that takes the current data and returns the new data.
	 */
	safeUpdate(cb: (data: T) => T | Promise<T>): ResultAsync<void, DataStoreError> {
		return ResultAsync.fromPromise(
			this.update(cb),
			(e) => new DataStoreError(`Error updating document ${this._id}`, { cause: e }),
		);
	}

	/**
	 * Apply a function to each element matching the given jsonpath.
	 */
	abstract apply(pathExpression: string, fn: (x: unknown) => unknown): Promise<void>;

	/**
	 * Apply a function to each element matching the given jsonpath. Same as {@link apply}, but returns a neverthrow {@link ResultAsync}.
	 */
	safeApply(
		pathExpression: string,
		fn: (x: unknown) => unknown,
	): ResultAsync<void, DataStoreError> {
		return ResultAsync.fromPromise(
			this.apply(pathExpression, fn),
			(e) =>
				new DataStoreError(`Error applying content transform to document ${this._id}`, {
					cause: e,
				}),
		);
	}

	abstract query(pathExpression: string): Promise<unknown[]>;

	safeQuery(pathExpression: string): ResultAsync<unknown[], DataStoreError> {
		return ResultAsync.fromPromise(
			this.query(pathExpression),
			(e) => new DataStoreError(`Error querying document ${this._id}`, { cause: e }),
		);
	}

	/**
	 * Close the file handle.
	 */
	abstract close(): Promise<void>;

	/**
	 * Close the file handle. Same as {@link close}, but returns a neverthrow {@link ResultAsync}.
	 */
	safeClose(): ResultAsync<void, DataStoreError> {
		return ResultAsync.fromPromise(
			this.close(),
			(e) => new DataStoreError(`Error closing document ${this._id}`, { cause: e }),
		);
	}
}

class SingleDocument<T = unknown> extends Document<T> {
	#hasBeenModified = false;
	#handlePromise: Promise<fs.FileHandle> | null = null;
	#path: string;

	#lastWriteSize = 0;

	constructor(directory: string, id: string) {
		super(id);
		const filename = id.includes(".") ? id : `${id}.json`;
		this.#path = path.resolve(directory, filename);
	}

	async initialize(data: T | Promise<T>) {
		const resolvedData = await data;

		// create the directory if it doesn't exist
		await fs.mkdir(path.dirname(this.#path), { recursive: true });

		// wx+ opens the file for reading and writing, creating it if it doesn't exist, and erroring if it does
		this.#handlePromise = fs.open(this.#path, "wx+").then(async (handle) => {
			await this.#write(resolvedData, handle);
			return handle;
		});

		return this.#handlePromise.then(() => this); // resolve void
	}

	static async create<T>(directory: string, id: string, data: T | Promise<T>) {
		const doc = new SingleDocument<T>(directory, id);
		await doc.initialize(data);
		return doc;
	}

	async #getHandle() {
		if (!this.#handlePromise) {
			throw new DataStoreError(`Document ${this._id} not initialized`);
		}

		return await this.#handlePromise;
	}

	override async _read(): Promise<T> {
		const handle = await this.#getHandle();

		const buffer = Buffer.alloc(this.#lastWriteSize);

		const readResult = await handle.read(buffer, 0, this.#lastWriteSize, 0);

		return JSON.parse(readResult.buffer.toString());
	}

	async #write(data: T, handle?: fs.FileHandle) {
		const writeHandle = handle ?? (await this.#getHandle());
		const dataStr = JSON.stringify(data);
		const buffer = Buffer.from(dataStr, "utf-8");
		await writeHandle.truncate(0); // truncate the file to 0 bytes
		await writeHandle.write(buffer, 0, buffer.length, 0);
		this.#lastWriteSize = buffer.length;
	}

	override async update(cb: (data: T) => T | Promise<T>) {
		if (!this.#hasBeenModified) {
			// on first modification, copy from the current path to the original path
			await fs.copyFile(
				this.#path,
				this.#path.replace(/(\.[^.]*)$/, ".original$1"), // replace the extension with .original.[extension]
				fs.constants.COPYFILE_EXCL, // fail if the original file already exists
			);

			this.#hasBeenModified = true;
		}

		const data = await this._read();

		const updatedData = await cb(data);

		await this.#write(updatedData);
	}

	override async apply(pathExpression: string, fn: (x: unknown) => unknown) {
		try {
			await this.update((data) => {
				const promises: Promise<void>[] = [];

				JSONPath({
					json: data as object,
					path: pathExpression,
					resultType: "all",
					ignoreEvalErrors: true,
					callback: ({ value }, _, { parent, parentProperty }) => {
						const fnResult = fn(value);

						if (fnResult instanceof Promise) {
							// if the function returns a promise, wait for it to resolve before updating the parent
							promises.push(
								fnResult.then((result) => {
									parent[parentProperty] = result;
								}),
							);
						} else {
							parent[parentProperty] = fnResult;
						}
					},
				});

				// wait for all promises to resolve before returning
				return Promise.all(promises).then(() => data);
			});
		} catch (e) {
			throw new DataStoreError(`Error applying content transform to document ${this._id}`, {
				cause: e,
			});
		}
	}

	override async query(pathExpression: string): Promise<unknown[]> {
		const data = await this._read();
		return JSONPath({
			json: data as object,
			path: pathExpression,
			resultType: "value",
			ignoreEvalErrors: true,
		});
	}

	override async close() {
		const handle = await this.#getHandle();
		await handle.close();
	}
}

/**
 * A batch of documents. This is a wrapper around a list of {@link SingleDocument}s that provides the same api for updating all documents in the batch.
 * This is useful for sources that return a list of documents via pagination.
 */
class BatchDocument<T = unknown> extends Document<T> {
	#documents: Array<SingleDocument<T>> = [];

	/**
	 * Add a zero-padded index to the document id. If id includes a file extension, it will be preserved after the index.
	 */
	static getIndexedId(id: string, index: number) {
		const paddedIndex = index.toString().padStart(2, "0");

		const lastDotIndex = id.lastIndexOf(".");

		if (lastDotIndex !== -1) {
			return `${id.slice(0, lastDotIndex)}-${paddedIndex}${id.slice(lastDotIndex)}`;
		}

		return `${id}-${paddedIndex}`;
	}

	override async _read(): Promise<T[]> {
		return Promise.all(this.#documents.map((doc) => doc._read()));
	}

	async initialize(directory: string, data: AsyncIterable<T>) {
		for await (const item of data) {
			this.#documents.push(
				await SingleDocument.create(
					directory,
					BatchDocument.getIndexedId(this._id, this.#documents.length),
					item,
				),
			);
		}
	}

	static async create<T>(directory: string, id: string, data: AsyncIterable<T>) {
		const doc = new BatchDocument<T>(id);
		await doc.initialize(directory, data);
		return doc;
	}

	override async update(cb: (data: T) => T | Promise<T>) {
		for (const doc of this.#documents) {
			await doc.update(cb);
		}
	}

	override async apply(pathExpression: string, fn: (x: unknown) => unknown) {
		for (const doc of this.#documents) {
			await doc.apply(pathExpression, fn);
		}
	}

	override async query(pathExpression: string): Promise<unknown[]> {
		const results: unknown[] = [];
		for (const doc of this.#documents) {
			const values = await doc.query(pathExpression);
			results.push(...values);
		}
		return results;
	}

	override async close() {
		await Promise.all(this.#documents.map((doc) => doc.close()));
	}
}

/**
 * A namespace represents a collection of documents for a single source.
 */
class Namespace {
	#id: string;
	#directory: string;

	#documents = new Map<string, Document>();

	#pendingInserts = new Map<string, Promise<void>>();

	constructor(parentDirectory: string, id: string) {
		this.#id = id;
		this.#directory = path.resolve(parentDirectory, id);
	}

	get id() {
		return this.#id;
	}

	initialize() {
		// create the directory if it doesn't exist
		return ensureDir(this.#directory);
	}

	/**
	 * Returns a promise that resolves when the document is available, or rejects if the document fails to insert.
	 * @param documentId
	 */
	waitFor(documentId: string): Promise<void> {
		if (this.#documents.has(documentId)) {
			return Promise.resolve();
		}

		const pendingInsert = this.#pendingInserts.get(documentId);

		if (!pendingInsert) {
			return Promise.reject(
				new DataStoreError(`Document ${documentId} not found in namespace ${this.#id}`),
			);
		}

		return pendingInsert;
	}

	async insert<T = unknown>(id: string, data: Promise<T> | AsyncIterable<T>): Promise<Document<T>> {
		let insertPromiseResolve: () => void;
		let insertPromiseReject: () => void;
		const insertPromise = new Promise<void>((resolve, reject) => {
			insertPromiseResolve = resolve;
			insertPromiseReject = reject;
		});

		this.#pendingInserts.set(id, insertPromise);

		insertPromise.finally(() => {
			this.#pendingInserts.delete(id);
		});

		if (data instanceof Promise) {
			const doc = await SingleDocument.create(this.#directory, id, data).then(
				(doc) => {
					insertPromiseResolve();
					return doc;
				},
				(e) => {
					insertPromiseReject();
					throw e;
				},
			);

			this.#documents.set(doc.id, doc);
			return doc;
		}

		const doc = await BatchDocument.create(this.#directory, id, data).then(
			(doc) => {
				insertPromiseResolve();
				return doc;
			},
			(e) => {
				insertPromiseReject();
				throw e;
			},
		);

		this.#documents.set(doc.id, doc);
		return doc;
	}

	safeInsert<T = unknown>(
		id: string,
		data: Promise<T> | AsyncIterable<T>,
	): ResultAsync<Document<T>, DataStoreError> {
		return ResultAsync.fromPromise(
			this.insert(id, data),
			(e) =>
				new DataStoreError(`Error inserting document ${id} into namespace ${this.#id}`, {
					cause: e,
				}),
		);
	}

	/**
	 * Get a document from the namespace.
	 */
	document(id: string): Result<Document, DataStoreError> {
		const document = this.#documents.get(id);
		if (!document) {
			return err(new DataStoreError(`Document ${id} not found in namespace ${this.#id}`));
		}

		return ok(document);
	}

	/**
	 * Get all documents in the namespace.
	 */
	documents() {
		return this.#documents.values();
	}
}

/**
 * In-memory data store for content. Used to store content during the fetch process,
 * and to provide an easy api for content transforms before writing to disk.
 */
export class DataStore {
	#namespaces = new Map<string, Namespace>();
	#directory: string;

	constructor(directory: string) {
		this.#directory = directory;
		// create the directory if it doesn't exist
		fs.mkdir(this.#directory, { recursive: true });
	}

	/**
	 * Get a namespace from the data store.
	 */
	namespace(namespaceId: string): Result<Namespace, DataStoreError> {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(new DataStoreError(`Namespace ${namespaceId} not found in data store`));
		}

		return ok(namespace);
	}

	getDocument(namespaceId: string, documentId: string): Result<Document, DataStoreError> {
		return this.namespace(namespaceId).andThen((ns) => ns.document(documentId));
	}

	/**
	 * Create a new namespace in the data store.
	 */
	createNamespace(namespaceId: string): ResultAsync<Namespace, DataStoreError> {
		if (this.#namespaces.has(namespaceId)) {
			return errAsync(new DataStoreError(`Namespace ${namespaceId} already exists in data store`));
		}

		const namespace = new Namespace(this.#directory, namespaceId);
		this.#namespaces.set(namespaceId, namespace);
		return namespace.initialize().andThen(() => okAsync(namespace));
	}

	allDocuments(): Iterable<Document> {
		return Array.from(this.#namespaces.values()).flatMap((ns) => Array.from(ns.documents()));
	}

	async close() {
		for (const namespace of this.#namespaces.values()) {
			for (const document of namespace.documents()) {
				await document.close();
			}
		}
	}

	/**
	 * Get lists of documents matching the passed DataKeys grouped by namespace.
	 * @param ids A list containing a combination of namespace ids, and namespace/document id tuples. If not provided, all documents will be matched.
	 */
	filter(
		ids?: DataKeys,
	): Result<Array<{ namespaceId: string; documents: Array<Document> }>, DataStoreError> {
		if (!ids) {
			return ok(
				Array.from(this.#namespaces.values()).map((ns) => ({
					namespaceId: ns.id,
					documents: Array.from(ns.documents()),
				})),
			);
		}

		const consolidatedIds = new Map<string, Set<string>>();

		for (const id of ids) {
			if (Array.isArray(id) && id.length === 2) {
				const [namespaceId, documentId] = id;

				const set = consolidatedIds.get(namespaceId);

				if (!set) {
					consolidatedIds.set(namespaceId, new Set([documentId]));
				} else {
					set.add(documentId);
				}
			} else {
				const idStr = Array.isArray(id) ? id[0] : id;

				const set = consolidatedIds.get(idStr);

				if (!set) {
					consolidatedIds.set(idStr, new Set(["*"]));
				} else {
					set.add("*");
				}
			}
		}

		const consolidatedIdsArray = Array.from(consolidatedIds.entries());

		return Result.combine(
			consolidatedIdsArray.map(([namespaceId, documentIds]) => {
				return this.namespace(namespaceId).map((ns) => {
					const documents = Array.from(ns.documents());

					if (documentIds.has("*")) {
						return {
							namespaceId,
							documents,
						};
					}
					return {
						namespaceId,
						documents: documents.filter((doc) => documentIds.has(doc.id)),
					};
				});
			}),
		);
	}
}
