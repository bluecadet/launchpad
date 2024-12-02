import ora from "ora";

// we're essentially just wrapping ora here incase we want to change the spinner library in the future

type SpinnerOptions = {
	text: string;
	autoStart?: boolean;
};

type PromiseSpinnerOptions = SpinnerOptions & {
	promise: Promise<unknown>;
	successText?: string;
	failText?: string;
};

export function spinner(spinnerOptions: SpinnerOptions) {
	const s = ora(spinnerOptions.text);
	if (spinnerOptions?.autoStart === undefined || spinnerOptions.autoStart) {
		s.start();
	}

	return s;
}

export function promiseSpinner({ promise, successText, failText, ...rest }: PromiseSpinnerOptions) {
	const s = spinner(rest);

	return promise
		.then(() => {
			s.succeed(successText);
		})
		.catch((err) => {
			s.fail(failText);
			throw err;
		});
}
