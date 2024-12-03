import fs from "node:fs/promises";
import path from "node:path";
import { Virtualenv } from "./utils/virtualenv.js";
import { promiseSpinner } from "./utils/promise-spinner.js";
import chalk from "chalk";

export async function initScaffold(options: {
	dir: string;
	cwd: string;
}) {
	if (!(await isValidScaffoldDir(options.dir))) {
		throw new Error("Invalid scaffold directory");
	}

	const resolvedDir = path.resolve(options.cwd, options.dir);

	const venv = new Virtualenv(resolvedDir);

	await promiseSpinner({
		text: `Checking for ${chalk.bold("virtualenv")} dependencies`,
		promise: venv.init(),
	});

	await promiseSpinner({
		text: `creating ${chalk.bold("virtual environment")}`,
		promise: venv.create(),
	});

	await promiseSpinner({
		text: `upgrading ${chalk.bold("pip")}`,
		promise: upgradePip(venv),
	});

	await promiseSpinner({
		text: `installing python modules from ${chalk.bold("requirements.txt")}`,
		promise: pipInstall(venv),
	});

	await promiseSpinner({
		text: `installing ansible galaxy roles/collections from ${chalk.bold("galaxy.yml")}`,
		promise: galaxyInstall(venv),
	});
}

async function isValidScaffoldDir(dir: string) {
	const REQUIRED_FILES = ["requirements.txt", "ansible.cfg"];
	const files = await fs.readdir(dir);

	for (const file of REQUIRED_FILES) {
		if (!files.includes(file)) {
			return false;
		}
	}

	return true;
}

async function upgradePip(venv: Virtualenv) {
	try {
		const result = await venv.exec("python3 -m pip install --upgrade pip");

		if (result.stderr) {
			throw new Error(result.stderr);
		}
	} catch (err) {
		throw new Error("Failed to upgrade pip", { cause: err });
	}
}

async function pipInstall(venv: Virtualenv) {
	try {
		const result = await venv.exec("pip install -r requirements.txt");

		if (result.stderr) {
			throw new Error(result.stderr);
		}
	} catch (err) {
		throw new Error("Failed to install pip dependencies", { cause: err });
	}
}

async function galaxyInstall(venv: Virtualenv) {
	try {
		const result = await venv.exec("ansible-galaxy install -r galaxy.yml");

		if (result.stderr) {
			throw new Error(result.stderr);
		}
	} catch (err) {
		throw new Error("Failed to install galaxy dependencies", { cause: err });
	}
}
