import { FixedConsoleLogger, NO_TTY } from "@bluecadet/launchpad-utils";
import chalk from "chalk";

type FetchData = Promise<unknown> | AsyncIterable<unknown>;

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type FetchState =
	| {
			state: "pending";
	  }
	| {
			state: "resolved";
			duration: number;
	  }
	| {
			state: "rejected";
			duration: number;
	  };

export class FetchLogger extends FixedConsoleLogger {
	#fetches: Map<string, Map<string, FetchState>> = new Map();
	#spinnerFrameIndex = 0;

	addFetch(sourceId: string, documentId: string, fetchPromise: FetchData): void {
		if (!this.#fetches.has(sourceId)) {
			this.#fetches.set(sourceId, new Map());
		}

		this.#fetches.get(sourceId)?.set(documentId, {
			state: "pending",
		});

		const startTime = Date.now();

		if (fetchPromise instanceof Promise) {
			fetchPromise
				.then(() => {
					const endTime = Date.now();
					const duration = endTime - startTime;
					this.#fetches.get(sourceId)?.set(documentId, { state: "resolved", duration });
					this.logger.info(
						`${this.getIcon("resolved")} Fetched ${documentId} from ${sourceId} in ${duration}ms`,
						{
							[NO_TTY]: true,
						},
					);
				})
				.catch(() => {
					const endTime = Date.now();
					const duration = endTime - startTime;
					this.#fetches.get(sourceId)?.set(documentId, { state: "rejected", duration });
					this.logger.error(
						`${this.getIcon("rejected")} Fetched ${documentId} from ${sourceId} in ${duration}ms`,
						{
							[NO_TTY]: true,
						},
					);
				});
		}
	}

	getIcon(state: FetchState["state"]) {
		switch (state) {
			case "pending":
				return chalk.cyan(spinnerFrames[this.#spinnerFrameIndex]);
			case "resolved":
				return chalk.green`✓`;
			case "rejected":
				return chalk.red`✗`;
		}
	}

	override getFixedConsoleMessage(): string {
		this.#spinnerFrameIndex = (this.#spinnerFrameIndex + 1) % spinnerFrames.length;

		let message = "";
		for (const [sourceId, documentFetches] of this.#fetches) {
			for (const [documentId, fetchState] of documentFetches) {
				message += ` ${this.getIcon(fetchState.state)} ${chalk.gray(`${sourceId}/`)}${documentId}`;

				if (fetchState.state !== "pending") {
					message += chalk.gray(` (${fetchState.duration}ms)`);
				}

				message += "\n";
			}
		}

		return message;
	}
}
