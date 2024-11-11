class LaunchpadCLIError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LaunchpadCLIError";
	}
}

export class ImportError extends LaunchpadCLIError {
	constructor(message: string) {
		super(message);
		this.name = "ImportError";
	}
}

export class ConfigError extends LaunchpadCLIError {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

export class MonitorError extends LaunchpadCLIError {
	constructor(message: string) {
		super(message);
		this.name = "MonitorError";
	}
}
