class LaunchpadCLIError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "LaunchpadCLIError";
	}
}

export class ImportError extends LaunchpadCLIError {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "ImportError";
	}
}

export class ConfigError extends LaunchpadCLIError {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "ConfigError";
	}
}

export class MonitorError extends LaunchpadCLIError {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "MonitorError";
	}
}
