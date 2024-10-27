import ky from 'ky';
import { Err, err, Ok, ok, ResultAsync } from 'neverthrow';

class BaseSafeKyError extends Error {
	/**
   * @param {string} message 
   * @param {unknown} [cause]  
   */
	constructor(message, cause) {
		if (cause === undefined) {
			super(message);
		} else if (cause instanceof Error) {
			super(`${message}: ${cause.message}`, { cause });
		} else {
			super(`${message}: ${cause}`);
		}
	}
}

export const SafeKyError = {
	FetchError: class extends BaseSafeKyError { },
	ParseError: class extends BaseSafeKyError { }
};

/**
 * Wraps a ky request in a ResultAsync
 * @param {import('ky').Input} input 
 * @param {import('ky').Options} [options]
 */
export function safeKy(input, options) {
	const req = ky(input, options);
	return SafeKyResultAsync.fromRequest(req);
}

/**
 * @template [T=unknown]
 * @typedef { Omit<import('ky').KyResponse<T>, 'json' | 'text' | 'arrayBuffer' | 'blob'>
 *  & {
 *    json: () => import('neverthrow').ResultAsync<any, BaseSafeKyError>,
 *    text: () => import('neverthrow').ResultAsync<string, BaseSafeKyError>,
 *    arrayBuffer: () => import('neverthrow').ResultAsync<ArrayBuffer, BaseSafeKyError>,
 *    blob: () => import('neverthrow').ResultAsync<Blob, BaseSafeKyError>
 *  }
 * } SafeKyResponseResult
 */

/**
 * @template T
 * @extends {ResultAsync<SafeKyResponseResult<T>, BaseSafeKyError>}
 */
class SafeKyResultAsync extends ResultAsync {
	/**
	 * @template T
	 * @param {import('ky').ResponsePromise<T>} promise 
	 * @returns {SafeKyResultAsync<T>}
	 */
	static fromRequest(promise) {
		const newPromise = promise
			.then((res) => {
				const remapped = {
					...res,
					json: () => ResultAsync.fromPromise(res.json(), (error) => new SafeKyError.ParseError('Error parsing JSON', error)),
					text: () => ResultAsync.fromPromise(res.text(), (error) => new SafeKyError.ParseError('Error parsing text', error)),
					arrayBuffer: () => ResultAsync.fromPromise(res.arrayBuffer(), (error) => new SafeKyError.ParseError('Error parsing array buffer', error)),
					blob: () => ResultAsync.fromPromise(res.blob(), (error) => new SafeKyError.ParseError('Error parsing blob', error))
				};
				
				return /** @type {Ok<SafeKyResponseResult, BaseSafeKyError>} */ (new Ok(remapped));
			})
			.catch((error) => {
				return /** @type {Err<SafeKyResponseResult, BaseSafeKyError>} */(new Err(new SafeKyError.FetchError('Error during request', error)));
			});

		return new SafeKyResultAsync(newPromise);
	}

	json() {
		return this.andThen((res) => res.json());
	}

	text() {
		return this.andThen((res) => res.text());
	}

	arrayBuffer() {
		return this.andThen((res) => res.arrayBuffer());
	}

	blob() {
		return this.andThen((res) => res.blob());
	}
}
