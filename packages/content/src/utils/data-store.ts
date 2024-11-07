import { JSONPath } from "jsonpath-plus";
import { Result, ResultAsync, err, ok } from "neverthrow";
import * as fs from "node:fs/promises";
import path from "node:path";

export class DataStoreError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "DataStoreError";
	}
}

/**
 * A list containing a combination of namespace ids, and namespace/document id tuples.
 */
export type DataKeys = Array<string | [string] | [string, string]>;

/**
 * A document represents a single file or resource.
 * It is a proxy for the underlying file, and provides a simple api for updating the file.
 * When the document is updated, a copy of the original file is created with the `.original` suffix.
 */
abstract class Document<T = unknown> {
	protected _id: string;

	constructor(id: string) {
		this._id = id;
	}

	get id() {
		return this._id;
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
		return ResultAsync.fromPromise(this.update(cb), (e) => new DataStoreError(`Error updating document ${this._id}`, { cause: e }));
	}

	/**
	 * Apply a function to each element matching the given jsonpath.
	 */
	abstract apply(pathExpression: string, fn: (x: unknown) => unknown): Promise<void>;

	/**
	 * Apply a function to each element matching the given jsonpath. Same as {@link apply}, but returns a neverthrow {@link ResultAsync}.
	 */
	safeApply(pathExpression: string, fn: (x: unknown) => unknown): ResultAsync<void, DataStoreError> {
		return ResultAsync.fromPromise(
			this.apply(pathExpression, fn),
			(e) => new DataStoreError(`Error applying content transform to document ${this._id}`, { cause: e }),
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
		return ResultAsync.fromPromise(this.close(), (e) => new DataStoreError(`Error closing document ${this._id}`, { cause: e }));
	}
}

class SingleDocument<T = unknown> extends Document<T> {
	#hasBeenModified = false;
	#handlePromise: Promise<fs.FileHandle> | null = null;
	#path: string;

	constructor(directory: string, id: string) {
		super(id);
		const filename = id.includes(".") ? id : `${id}.json`;
		this.#path = path.join(directory, filename);
	}

	async initialize(data: T | Promise<T>) {
		const resolvedData = await data;

		// wx+ opens the file for reading and writing, creating it if it doesn't exist, and erroring if it does
		this.#handlePromise = fs.open(this.#path, "wx+").then((handle) => {
			handle.write(JSON.stringify(resolvedData));
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

		const handle = await this.#getHandle();
		const data = await fs.readFile(handle, "utf-8");

		const updatedData = cb(JSON.parse(data));

		await fs.writeFile(handle, JSON.stringify(updatedData));
	}

	override async apply(pathExpression: string, fn: (x: unknown) => unknown) {
		await this.update((data) => {
			JSONPath({
				json: data as object,
				path: pathExpression,
				resultType: "all",
				callback: ({ value }, _, { parent, parentProperty }) => {
					parent[parentProperty] = fn(value);
				},
			});

			return data;
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
export class BatchDocument<T = unknown> extends Document<T> {
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

	async initialize(directory: string, data: AsyncIterable<T>) {
		for await (const item of data) {
			this.#documents.push(await SingleDocument.create(directory, BatchDocument.getIndexedId(this._id, this.#documents.length), item));
		}
	}

	static async create<T>(directory: string, id: string, data: AsyncIterable<T>) {
		const doc = new BatchDocument<T>(id);
		await doc.initialize(directory, data);
		return doc;
	}

	override async update(cb: (data: T) => T | Promise<T>) {
		await Promise.all(this.#documents.map((doc) => doc.update(cb)));
	}

	override async apply(pathExpression: string, fn: (x: unknown) => unknown) {
		await Promise.all(this.#documents.map((doc) => doc.apply(pathExpression, fn)));
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

	constructor(parentDirectory: string, id: string) {
		this.#id = id;
		this.#directory = path.join(parentDirectory, id);
	}

	get id() {
		return this.#id;
	}

	async insert<T = unknown>(data: Promise<T> | AsyncIterable<T>) {
		if (data instanceof Promise) {
			const doc = await SingleDocument.create(this.#directory, BatchDocument.getIndexedId(this.#id, this.#documents.size), data);
			this.#documents.set(doc.id, doc);
		} else {
			const doc = await BatchDocument.create(this.#directory, this.#id, data);
			this.#documents.set(doc.id, doc);
		}
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
	namespace(namespaceId: string): Result<Iterable<Document>, DataStoreError> {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(new DataStoreError(`Namespace ${namespaceId} not found in data store`));
		}

		return ok(namespace.documents());
	}

	/**
	 * Create a new namespace in the data store.
	 */
	createNamespace(namespaceId: string): Result<void, DataStoreError> {
		if (this.#namespaces.has(namespaceId)) {
			return err(new DataStoreError(`Namespace ${namespaceId} already exists in data store`));
		}

		this.#namespaces.set(namespaceId, new Namespace(this.#directory, namespaceId));
		return ok(undefined);
	}

	/**
	 * Get lists of documents matching the passed DataKeys grouped by namespace.
	 * @param ids A list containing a combination of namespace ids, and namespace/document id tuples. If not provided, all documents will be matched.
	 */
	filter(ids?: DataKeys): Result<Array<{ namespaceId: string; documents: Array<Document> }>, DataStoreError> {
		if (!ids) {
			return ok(Array.from(this.#namespaces.values()).map((ns) => ({ namespaceId: ns.id, documents: Array.from(ns.documents()) })));
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
				return this.namespace(namespaceId).map((docs) => {
					const documents = Array.from(docs);

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
