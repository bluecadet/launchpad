import fs from "node:fs/promises";
import path from "node:path";
import { Virtualenv } from "./utils/virtualenv.js";
import { exec } from "node:child_process";

export async function initScaffold(options: {
	dir: string;
	cwd: string;
}) {
	if (!(await isValidScaffoldDir(options.dir))) {
		throw new Error("Invalid scaffold directory");
	}

	const resolvedDir = path.resolve(options.cwd, options.dir);

	const venv = new Virtualenv(resolvedDir);

	await venv.init();

	await venv.create();

	await upgradePip(venv);

	await pipInstall(venv);
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
		throw new Error("Failed to install python requirements", { cause: err });
	}
}
