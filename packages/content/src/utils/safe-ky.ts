import ky, { type Input, type KyResponse, type Options, type ResponsePromise } from "ky";
import { Err, Ok, ResultAsync } from "neverthrow";

export class SafeKyFetchError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "SafeKyFetchError";
	}
}

export class SafeKyParseError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "SafeKyParseError";
	}
}

export function safeKy(input: Input, options?: Options): SafeKyResultAsync {
	const req = ky(input, options);
	return SafeKyResultAsync.fromRequest(req);
}

type SafeKyResponseResult<T = unknown> = Omit<
	KyResponse<T>,
	"json" | "text" | "arrayBuffer" | "blob"
> & {
	// biome-ignore lint/suspicious/noExplicitAny: TODO
	json: () => ResultAsync<any, SafeKyParseError>;
	text: () => ResultAsync<string, SafeKyParseError>;
	arrayBuffer: () => ResultAsync<ArrayBuffer, SafeKyParseError>;
	blob: () => ResultAsync<Blob, SafeKyParseError>;
};

class SafeKyResultAsync<T = unknown> extends ResultAsync<
	SafeKyResponseResult<T>,
	SafeKyFetchError | SafeKyParseError
> {
	static fromRequest<T>(promise: ResponsePromise<T>): SafeKyResultAsync<T> {
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
					json: () =>
						ResultAsync.fromPromise(
							res.json(),
							(error) => new SafeKyParseError("Error parsing JSON", { cause: error }),
						),
					text: () =>
						ResultAsync.fromPromise(
							res.text(),
							(error) => new SafeKyParseError("Error parsing text", { cause: error }),
						),
					arrayBuffer: () =>
						ResultAsync.fromPromise(
							res.arrayBuffer(),
							(error) => new SafeKyParseError("Error parsing array buffer", { cause: error }),
						),
					blob: () =>
						ResultAsync.fromPromise(
							res.blob(),
							(error) => new SafeKyParseError("Error parsing blob", { cause: error }),
						),
				};

				return new Ok(remapped) as Ok<SafeKyResponseResult<T>, SafeKyFetchError | SafeKyParseError>;
			})
			.catch((error) => {
				return new Err(new SafeKyFetchError("Error during request", { cause: error })) as Err<
					SafeKyResponseResult<T>,
					SafeKyFetchError | SafeKyParseError
				>;
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
