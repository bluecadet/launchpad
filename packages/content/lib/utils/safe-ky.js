import ky from 'ky';
import { Err, err, Ok, ok, ResultAsync } from 'neverthrow';

export class SafeKyFetchError extends Error {
	/**
	 * @param {ConstructorParameters<typeof Error>} args
	 */
	constructor(...args) {
		super(...args);
		this.name = 'SafeKyFetchError';
	}
}

export class SafeKyParseError extends Error {
	/**
	 * @param {ConstructorParameters<typeof Error>} args
	 */
	constructor(...args) {
		super(...args);
		this.name = 'SafeKyParseError';
	}
}

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
 *    json: () => import('neverthrow').ResultAsync<any, SafeKyParseError>,
 *    text: () => import('neverthrow').ResultAsync<string, SafeKyParseError>,
 *    arrayBuffer: () => import('neverthrow').ResultAsync<ArrayBuffer, SafeKyParseError>,
 *    blob: () => import('neverthrow').ResultAsync<Blob, SafeKyParseError>
 *  }
 * } SafeKyResponseResult
 */

/**
 * @template T
 * @extends {ResultAsync<SafeKyResponseResult<T>, SafeKyFetchError | SafeKyParseError>}
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
					headers: res.headers,
					ok: res.ok,
					status: res.status,
					statusText: res.statusText,
					type: res.type,
					url: res.url,
					redirected: res.redirected,
					body: res.body,
					json: () => ResultAsync.fromPromise(res.json(), (error) => new SafeKyParseError('Error parsing JSON', { cause: error })),
					text: () => ResultAsync.fromPromise(res.text(), (error) => new SafeKyParseError('Error parsing text', { cause: error })),
					arrayBuffer: () => ResultAsync.fromPromise(res.arrayBuffer(), (error) => new SafeKyParseError('Error parsing array buffer', { cause: error })),
					blob: () => ResultAsync.fromPromise(res.blob(), (error) => new SafeKyParseError('Error parsing blob', { cause: error }))
				};
				
				return /** @type {Ok<SafeKyResponseResult, SafeKyFetchError | SafeKyParseError>} */ (new Ok(remapped));
			})
			.catch((error) => {
				return /** @type {Err<SafeKyResponseResult, SafeKyFetchError | SafeKyParseError>} */(new Err(new SafeKyFetchError('Error during request', { cause: error })));
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
