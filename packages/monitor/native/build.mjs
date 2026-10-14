#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Maintainer-only cross-build. Never called by install/release or runtime code.
const zigVersion = "0.15.2";
const nodeVersion = "22.16.0";
const nodeOrigin = "https://nodejs.org";
const baseUrl = `${nodeOrigin}/dist/v${nodeVersion}/`;
// Independently pinned as well as checked against the official HTTPS manifest.
const checksums = {
	[`node-v${nodeVersion}-headers.tar.gz`]:
		"a60e5a543fab5e5105525948c596d4974c617f39606cef76eb94c3bf1df9a06c",
	"win-x64/node.lib": "a3498bf1b8eebb3a07b1c7e9e28703fed4f1ce0b520d5f6898ae607862178cd2",
	"win-arm64/node.lib": "344c1d69f0b008da7318c29397d552c6ad8d9d6b94c115a35c6eaf278e87d24c",
};
const targets = { x64: "x86_64-windows-gnu", arm64: "aarch64-windows-gnu" };
const nativeDirectory = dirname(fileURLToPath(import.meta.url));
const zig = process.env.ZIG || "zig";
const cacheDirectory = resolve(
	process.env.MONITOR_NATIVE_CACHE ||
		join(homedir(), ".cache", "launchpad-monitor-native", `node-v${nodeVersion}`),
);

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || ""}${result.stdout || ""}`,
		);
	}
	return result.stdout.trim();
}

function sha256(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

async function officialDownload(path) {
	const response = await fetch(new URL(path, baseUrl), {
		redirect: "error",
		signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) throw new Error(`Official Node download failed: ${response.status} ${path}`);
	if (new URL(response.url).origin !== nodeOrigin)
		throw new Error("Refusing non-official Node download");
	return Buffer.from(await response.arrayBuffer());
}

async function verifiedInput(path, manifest) {
	const expected = checksums[path];
	if (manifest.get(path) !== expected)
		throw new Error(`Official SHASUMS256.txt does not match pinned digest for ${path}`);
	const cachedPath = join(cacheDirectory, path);
	let contents;
	try {
		contents = await readFile(cachedPath);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (contents && sha256(contents) !== expected)
		throw new Error(`Cached file checksum mismatch: ${cachedPath}; remove it and retry`);
	if (!contents) {
		contents = await officialDownload(path);
		if (sha256(contents) !== expected)
			throw new Error(`Downloaded file checksum mismatch: ${path}`);
		await mkdir(dirname(cachedPath), { recursive: true });
		const temporaryPath = `${cachedPath}.${process.pid}.tmp`;
		try {
			await writeFile(temporaryPath, contents, { flag: "wx" });
			await rename(temporaryPath, cachedPath);
		} finally {
			await rm(temporaryPath, { force: true });
		}
	}
	return cachedPath;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help")) {
		console.log(
			"Usage: node packages/monitor/native/build.mjs [--arch x64|arm64|all]\nRequires Zig 0.15.2 (ZIG=/path/to/zig), tar, and HTTPS access to nodejs.org.\nMONITOR_NATIVE_CACHE optionally selects the verified download cache.",
		);
		return;
	}
	if (args.length !== 0 && (args.length !== 2 || args[0] !== "--arch"))
		throw new Error("Expected --arch x64|arm64|all (or no arguments for both)");
	const architecture = args[1] || "all";
	if (!["all", "x64", "arm64"].includes(architecture))
		throw new Error(`Unsupported architecture: ${architecture}`);
	const architectures = architecture === "all" ? Object.keys(targets) : [architecture];
	const actualZigVersion = run(zig, ["version"]);
	if (actualZigVersion !== zigVersion)
		throw new Error(
			`Expected official stable Zig ${zigVersion}; got ${actualZigVersion}. Set ZIG to the pinned compiler.`,
		);

	const manifestText = (await officialDownload("SHASUMS256.txt")).toString("utf8");
	const manifest = new Map(
		manifestText
			.trim()
			.split(/\r?\n/)
			.map((line) => {
				const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
				if (!match) throw new Error("Invalid official SHASUMS256.txt");
				return [match[2], match[1]];
			}),
	);
	const headers = await verifiedInput(`node-v${nodeVersion}-headers.tar.gz`, manifest);
	const libraries = new Map(
		await Promise.all(
			architectures.map(async (arch) => [
				arch,
				await verifiedInput(`win-${arch}/node.lib`, manifest),
			]),
		),
	);
	const buildDirectory = await mkdtemp(join(tmpdir(), "launchpad-monitor-native-"));
	try {
		run("tar", ["-xzf", headers, "-C", buildDirectory]);
		const includeDirectory = join(buildDirectory, `node-v${nodeVersion}`, "include", "node");
		for (const arch of architectures) {
			const output = join(buildDirectory, `windows-${arch}.node`);
			const compileArgs = [
				"cc",
				"-target",
				targets[arch],
				"-std=c11",
				"-shared",
				"-Os",
				"-s",
				"-Wall",
				"-Wextra",
				"-Werror",
				"-fno-sanitize=all",
				"-DNAPI_VERSION=8",
				"-DBUILDING_NODE_EXTENSION",
				"-I",
				includeDirectory,
				join(nativeDirectory, "windows.c"),
				libraries.get(arch),
				"-luser32",
				"-o",
				output,
			];
			console.log(
				`Building win32-${arch} with Zig ${zigVersion}, Node ${nodeVersion} headers / Node-API 8`,
			);
			run(zig, compileArgs);
		}
		// Only replace bundled artifacts after every requested architecture builds.
		for (const arch of architectures) {
			const output = join(buildDirectory, `windows-${arch}.node`);
			const destination = join(nativeDirectory, "..", "prebuilds", `win32-${arch}`, "windows.node");
			const contents = await readFile(output);
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, contents);
			await chmod(destination, 0o644);
			console.log(`${destination}: ${contents.length} bytes, sha256 ${sha256(contents)}`);
		}
	} finally {
		await rm(buildDirectory, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
