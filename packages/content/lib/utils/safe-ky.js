import ky from "ky";
import { err, ok, ResultAsync } from "neverthrow";


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
  ParseError: class extends BaseSafeKyError { },
}

/**
 * Wraps a ky request in a ResultAsync
 * @param {import('ky').Input} input 
 * @param {import('ky').Options} [options]
 */
export function safeKy(input, options) {
  const req = ky(input, options);

  const baseResultAsync = ResultAsync.fromPromise(req, (error) => new SafeKyError.FetchError(`Error during request`, error)).andThen((res) => {
    if (!res.ok) {
      return err(new SafeKyError.FetchError(`Request failed with status ${res.status}`));
    }
    return ok(res);
  });

  return {
    json: () => baseResultAsync.andThen((res) => ResultAsync.fromPromise(res.json(), (error) => new SafeKyError.ParseError(`Error parsing JSON`, error))),
    text: () => baseResultAsync.andThen((res) => ResultAsync.fromPromise(res.text(), (error) => new SafeKyError.ParseError(`Error parsing text`, error))),
    arrayBuffer: () => baseResultAsync.andThen((res) => ResultAsync.fromPromise(res.arrayBuffer(), (error) => new SafeKyError.ParseError(`Error parsing array buffer`, error))),
    blob: () => baseResultAsync.andThen((res) => ResultAsync.fromPromise(res.blob(), (error) => new SafeKyError.ParseError(`Error parsing blob`, error))),
    body: baseResultAsync.andThen((res) => ok(res.body)),
  };
}
