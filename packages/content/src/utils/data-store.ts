import { JSONPath } from "jsonpath-plus";
import { Result, err, ok } from "neverthrow";

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
 */
export class Document<T = unknown> {
	#id: string;
	#originalData: T;

	constructor(id: string, data: T) {
		this.#id = id;
		this.#originalData = data;
	}

	get id() {
		return this.#id;
	}

	/**
	 * Returns a copy of the document's data.
	 */
	get data() {
		return this.#originalData;
	}

	update(data: T) {
		this.#originalData = data;
	}

	/**
	 * Apply a function to each element matching the given jsonpath.
	 */
	apply(pathExpression: string, fn: (x: unknown) => unknown): Result<void, DataStoreError> {
		// catch errrors thrown from JSONPath OR the fn callback
		try {
			JSONPath({
				json: this.#originalData as object,
				path: pathExpression,
				resultType: "all",
				callback: ({ value }, _, { parent, parentProperty }) => {
					parent[parentProperty] = fn(value);
				},
			});

			return ok(undefined);
		} catch (e) {
			return err(new DataStoreError("Error applying content transform", { cause: e }));
		}
	}
}

/**
 * A namespace represents a collection of documents for a single source.
 */
class Namespace {
	#id: string;

	#documents = new Map<string, Document>();

	constructor(id: string) {
		this.#id = id;
	}

	get id() {
		return this.#id;
	}

	insert(id: string, data: unknown): Result<void, DataStoreError> {
		if (this.#documents.has(id)) {
			return err(new DataStoreError(`Document ${id} already exists in namespace ${this.#id}`));
		}

		this.#documents.set(id, new Document(id, data));
		return ok(undefined);
	}

	get(id: string): Result<Document, DataStoreError> {
		const document = this.#documents.get(id);
		if (!document) {
			return err(new DataStoreError(`Document ${id} not found in namespace ${this.#id}`));
		}

		return ok(document);
	}

	documents() {
		return this.#documents.values();
	}

	delete(id: string): Result<void, DataStoreError> {
		this.#documents.delete(id);
		return ok(undefined);
	}

	update(id: string, data: unknown): Result<void, DataStoreError> {
		this.#documents.set(id, new Document(id, data));
		return ok(undefined);
	}
}

/**
 * In-memory data store for content. Used to store content during the fetch process,
 * and to provide an easy api for content transforms before writing to disk.
 */
export class DataStore {
	#namespaces = new Map<string, Namespace>();

	get(namespaceId: string, documentId: string): Result<Document, DataStoreError> {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(new DataStoreError(`Namespace ${namespaceId} not found in data store`));
		}

		return namespace.get(documentId);
	}

	namespace(namespaceId: string): Result<Iterable<Document>, DataStoreError> {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(new DataStoreError(`Namespace ${namespaceId} not found in data store`));
		}

		return ok(namespace.documents());
	}

	*allDocuments() {
		for (const namespace of this.namespaces()) {
			yield* namespace.documents();
		}
	}

	namespaces() {
		return this.#namespaces.values();
	}

	createNamespace(namespaceId: string): Result<void, DataStoreError> {
		if (this.#namespaces.has(namespaceId)) {
			return err(new DataStoreError(`Namespace ${namespaceId} already exists in data store`));
		}

		this.#namespaces.set(namespaceId, new Namespace(namespaceId));
		return ok(undefined);
	}

	createNamespaceFromMap(namespaceId: string, map: Map<string, unknown>): Result<void, DataStoreError> {
		const namespaceResult = this.createNamespace(namespaceId);

		if (namespaceResult.isErr()) {
			return namespaceResult;
		}

		for (const [documentId, data] of map.entries()) {
			const insertResult = this.insert(namespaceId, documentId, data);
			if (insertResult.isErr()) {
				return insertResult;
			}
		}

		return ok(undefined);
	}

	insert(namespaceId: string, documentId: string, data: unknown): Result<void, DataStoreError> {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(new DataStoreError(`Namespace ${namespaceId} not found in data store`));
		}

		return namespace.insert(documentId, data);
	}

	delete(namespaceId: string, documentId: string): Result<void, DataStoreError> {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(new DataStoreError(`Namespace ${namespaceId} not found in data store`));
		}

		return namespace.delete(documentId);
	}

	/**
	 * Get lists of documents matching the passed DataKeys grouped by namespace.
	 * @param ids A list containing a combination of namespace ids, and namespace/document id tuples. If not provided, all documents will be matched.
	 */
	filter(ids?: DataKeys): Result<Array<{ namespaceId: string; documents: Array<Document> }>, DataStoreError> {
		if (!ids) {
			return ok(Array.from(this.namespaces()).map((ns) => ({ namespaceId: ns.id, documents: Array.from(ns.documents()) })));
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
