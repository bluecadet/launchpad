export class LaunchpadCLIError extends Error {
	/**
   * @param {string} message 
   */
	constructor(message) {
		super(message);
		this.name = 'LaunchpadCLIError';
	}
}

export class ImportError extends LaunchpadCLIError {
	/**
   * @param {string} message 
   */
	constructor(message) {
		super(message);
		this.name = 'ImportError';
	}
}

export class ConfigError extends LaunchpadCLIError {
	/**
   * @param {string} message 
   */
	constructor(message) {
		super(message);
		this.name = 'ConfigError';
	}
}

export class MonitorError extends LaunchpadCLIError {
	/**
   * @param {string} message 
   */
	constructor(message) {
		super(message);
		this.name = 'MonitorError';
	}
}
