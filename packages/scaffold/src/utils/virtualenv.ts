import { lookpath } from "lookpath";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "./exec.js";

const VENV_ENV_NAME = "VIRTUAL_ENV";
const PATH_ENV_NAME = "PATH";
const VIRTUAL_ENV_DIR = ".venv";

export class Virtualenv {
	readonly #scaffoldDir: string;
	readonly #path: string;
	readonly #binPath: string;
	#executablePath: string | null = null;

	constructor(scaffoldDir: string) {
		this.#scaffoldDir = scaffoldDir;
		this.#path = path.resolve(scaffoldDir, VIRTUAL_ENV_DIR);
		this.#binPath = path.resolve(this.#path, "bin");
	}

	public async create() {
		if (!this.#executablePath) {
			throw new Error("Virtualenv not initialized");
		}

		const result = await exec(`${this.#executablePath} ${this.#path}`);

		if (result.stderr) {
			throw new Error(result.stderr);
		}
	}

	public async init() {
		const path = await Virtualenv.getExecutablePath();
		this.#executablePath = path;
	}

	public async destroy() {
		await fs.rm(this.#path, { recursive: true, force: true });
	}

	public async exec(command: string) {
		const env = {
			...process.env,
			[VENV_ENV_NAME]: this.#path,
			[PATH_ENV_NAME]: `${this.#binPath}:${process.env[PATH_ENV_NAME]}`,
		};

		return exec(command, { env, cwd: this.#scaffoldDir });
	}

	/**
	 * Check if virtualenv is installed, either as a python3 module or as a system package.
	 * Returns the path to the virtualenv executable.
	 */
	private static async getExecutablePath() {
		const py3Path = await lookpath("python3");

		if (py3Path) {
			const cmd = await exec(`${py3Path} -m ensurepip --version`);

			if (!cmd.stderr) {
				return `${py3Path} -m venv`;
			}
		}

		const path = await lookpath("virtualenv");

		if (path) {
			return path;
		}

		throw new Error("virtualenv not found");
	}
}
