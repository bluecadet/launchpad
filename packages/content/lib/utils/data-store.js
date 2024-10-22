import jsonpath from 'jsonpath';
import { ok, err, Result } from 'neverthrow';

/**
 * A document represents a single file or resource.
 * @template {unknown} [T=unknown]
 */
export class Document {
	/**
   * @type {string}
   */
	#id;

	/**
   * @type {T}
   */
	#originalData;

	/**
   * @type {T}
   */
	#readonlyCopy;

	/**
   * @param {string} id
   * @param {T} data
   */
	constructor(id, data) {
		this.#id = id;
		this.#originalData = data;

		if (typeof data === 'object' && data !== null) {
			const proxy = new Proxy(/** @type {object} */(this.#originalData), {
				get: (target, prop) => {
					return /** @type {any} */ (target)[prop];
				}
			});
			this.#readonlyCopy = /** @type {Readonly<T>} */ (proxy);
		} else {
			this.#readonlyCopy = /** @type {Readonly<T>} */ (data); // not necessarily readonly, but still a copy
		}
	}

	/**
   * @returns {string}
   */
	get id() {
		return this.#id;
	}

	/**
   * Read-only copy of the document's data.
   */
	get data() {
		return this.#readonlyCopy;
	}

	/**
   * @param {T} data
   */
	update(data) {
		this.#originalData = data;
	}

	/**
   * Apply a function to each element matching the given jsonpath.
   * @param {string} pathExpression
   * @param {(x: unknown) => unknown} fn
   */
	apply(pathExpression, fn) {
		return jsonpath.apply(this.#originalData, pathExpression, fn);
	}
}

/**
 * A namespace represents a collection of documents for a single source. 
 */
class Namespace {
	/**
   * @type {string}
   */
	#id;

	/**
   * @type {Map<string, Document>}
   */
	#documents = new Map();

	/**
   * @param {string} id
   */
	constructor(id) {
		this.#id = id;
	}

	get id() {
		return this.#id;
	}

	/**
   * @param {string} id
   * @param {unknown} data
   * @returns {Result<void, string>}
   */
	insert(id, data) {
		if (this.#documents.has(id)) {
			return err(`Document ${id} already exists in namespace ${this.#id}`);
		}

		this.#documents.set(id, new Document(id, data));
		return ok(undefined);
	}

	/**
   * @param {string} id
   * @returns {Result<Document, string>}
   */
	get(id) {
		const document = this.#documents.get(id);
		if (!document) {
			return err(`Document ${id} not found in namespace ${this.#id}`);
		}

		return ok(document);
	}

	/**
   * @returns {Iterable<Document>}
   */
	* documents() {
		yield * this.#documents.values();
	}

	/**
   * @param {string} id
   * @returns {Result<void, string>}
   */
	delete(id) {
		this.#documents.delete(id);
		return ok(undefined);
	}

	/**
   * @param {string} id
   * @param {unknown} data
   * @returns {Result<void, string>}
   */
	update(id, data) {
		this.#documents.set(id, new Document(id, data));
		return ok(undefined);
	}
}

/**
 * In-memory data store for content. Used to store content during the fetch process,
 * and to provide an easy api for content transforms before writing to disk.
 */
export class DataStore {
	/**
   * @type {Map<string, Namespace>}
   */
	#namespaces = new Map();

	/**
   * @param {string} namespaceId
   * @param {string} documentId
   * @returns {Result<Document, string>}
   */
	get(namespaceId, documentId) {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(`Namespace ${namespaceId} not found in data store`);
		}

		return namespace.get(documentId);
	}

	/**
   * @param {string} namespaceId
   * @returns {Result<Iterable<Document>, string>}
   */
	documents(namespaceId) {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(`Namespace ${namespaceId} not found in data store`);
		}

		return ok(namespace.documents());
	}

	/**
   * @returns {Iterable<Document>}
   */
	* allDocuments() {
		for (const namespace of this.namespaces()) {
			yield * namespace.documents();
		}
	}

	/**
   * @returns {Iterable<Namespace>}
   */
	* namespaces() {
		yield * this.#namespaces.values();
	}

	/**
   * @param {string} namespaceId
   * @returns {Result<void, string>}
   */
	createNamespace(namespaceId) {
		if (this.#namespaces.has(namespaceId)) {
			return err(`Namespace ${namespaceId} already exists in data store`);
		}

		this.#namespaces.set(namespaceId, new Namespace(namespaceId));
		return ok(undefined);
	}

	/**
   * @param {string} namespaceId
   * @param {Map<string, unknown>} map
   * @returns {Result<void, string>}
   */
	createNamespaceFromMap(namespaceId, map) {
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

	/**
   * @param {string} namespaceId
   * @param {string} documentId
   * @param {unknown} data
   * @returns {Result<void, string>}
   */
	insert(namespaceId, documentId, data) {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(`Namespace ${namespaceId} not found in data store`);
		}

		return namespace.insert(documentId, data);
	}

	/**
   * @param {string} namespaceId
   * @param {string} documentId
   * @returns {Result<void, string>}
   */
	delete(namespaceId, documentId) {
		const namespace = this.#namespaces.get(namespaceId);
		if (!namespace) {
			return err(`Namespace ${namespaceId} not found in data store`);
		}

		return namespace.delete(documentId);
	}
}
