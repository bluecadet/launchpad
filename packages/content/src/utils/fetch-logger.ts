import type { EventBus } from "@bluecadet/launchpad-utils/controller-interfaces";
import { FixedTTYLogger } from "@bluecadet/launchpad-utils/fixed-tty-logger";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import chalk from "chalk";
import type { ResultAsync } from "neverthrow";

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

export class FetchLogger extends FixedTTYLogger {
	#fetches: Map<string, Map<string, FetchState>> = new Map();
	#spinnerFrameIndex = 0;

	constructor(
		private logger: Logger,
		eventBus: EventBus,
	) {
		super(eventBus);
	}

	async addFetch(
		sourceId: string,
		documentId: string,
		fetchPromise: ResultAsync<unknown, unknown>,
	): Promise<void> {
		if (!this.#fetches.has(sourceId)) {
			this.#fetches.set(sourceId, new Map());
		}

		this.#fetches.get(sourceId)?.set(documentId, {
			state: "pending",
		});

		const startTime = Date.now();

		try {
			const result = await fetchPromise;

			if (!result.isOk()) {
				throw result.error;
			}

			const endTime = Date.now();
			const duration = endTime - startTime;
			this.#fetches.get(sourceId)?.set(documentId, { state: "resolved", duration });
			this.logger.debug(
				`${this.getIcon("resolved")} Fetched ${documentId} from ${sourceId} in ${duration}ms`,
			);
		} catch (_e) {
			const endTime = Date.now();
			const duration = endTime - startTime;
			this.#fetches.get(sourceId)?.set(documentId, { state: "rejected", duration });
			this.logger.error(
				`${this.getIcon("rejected")} Failed to fetch ${documentId} from ${sourceId}`,
			);
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
