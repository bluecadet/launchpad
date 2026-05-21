import { errAsync, type ResultAsync } from "neverthrow";

export class CommandInProgressError extends Error {
	constructor() {
		super("A command is already in progress.");
		this.name = "CommandInProgressError";
	}
}

export class SingleCommandGuard {
	private _lock = false;

	public run<T, E>(fn: () => ResultAsync<T, E>): ResultAsync<T, E | CommandInProgressError> {
		if (this._lock) {
			return errAsync(new CommandInProgressError());
		}
		this._lock = true;
		return fn()
			.andTee(() => {
				this._lock = false;
			})
			.orTee(() => {
				this._lock = false;
			});
	}
}
