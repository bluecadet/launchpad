import jsonpath from 'jsonpath';
import { ok, err } from 'neverthrow';

/**
 * In-memory data store for content. Used to store content during the fetch process,
 * and to provide an easy api for content transforms before writing to disk.
 */
export default class DataStore {
  /**
   * @type {Map<string, unknown>}
   */
  #data = new Map();

  /**
   * @param {string} key
   * @param {unknown} value
   */
  insert(key, value) {
    if (this.#data.has(key)) {
      return err(`Key ${key} already exists in data store. Did you mean to use update()?`);
    }

    this.#data.set(key, value);
    return ok(value);
  }

  /**
   * @param {string} key
   * @returns {unknown}
   */
  get(key) {
    if (!this.#data.has(key)) {
      return err(`Key ${key} not found in data store`);
    }

    return ok(this.#data.get(key));
  }

  /**
   * @param {string} key
   * @param {unknown} value
   */
  update(key, value) {
    if (!this.#data.has(key)) {
      return err(`Key ${key} not found in data store. Did you mean to use insert()?`);
    }

    this.#data.set(key, value);
    return ok(value);
  }

  /**
   * Runs the supplied applyFn on the nodes located at the specified path.
   * Uses jsonpath under the hood.
   * 
   * @param {string} key
   * @param {string} path
   * @param {(value: unknown) => unknown} applyFn
   */
  apply(key, path, applyFn) {
    if (!this.#data.has(key)) {
      return err(`Key ${key} not found in data store`);
    }

    const result = jsonpath.apply(this.#data.get(key), path, applyFn);
    return ok(result);
  }

  /**
   * Get all keys in the data store.
   * @returns {Iterable<string>}
   */
  keys() {
    return this.#data.keys();
  }
}
