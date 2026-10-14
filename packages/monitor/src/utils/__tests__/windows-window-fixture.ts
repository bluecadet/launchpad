import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { WindowIdentity } from "../windows-native.js";

type WindowState = WindowIdentity & { visible: boolean; minimized: boolean };
type ExpectedState = { visible?: boolean; minimized?: boolean };

export interface WindowsWindowFixture {
	identity: WindowIdentity;
	title: string;
	waitForState(expected: ExpectedState): Promise<void>;
	dispose(): Promise<void>;
}

function parseState(line: string): WindowState {
	const value: unknown = JSON.parse(line);
	if (
		typeof value !== "object" ||
		value === null ||
		!("id" in value) ||
		typeof value.id !== "string" ||
		!/^[1-9][0-9]{0,19}$/.test(value.id) ||
		BigInt(value.id) > 18446744073709551615n ||
		!("processId" in value) ||
		typeof value.processId !== "number" ||
		!Number.isInteger(value.processId) ||
		value.processId < 1 ||
		value.processId > 4294967295 ||
		!("visible" in value) ||
		typeof value.visible !== "boolean" ||
		!("minimized" in value) ||
		typeof value.minimized !== "boolean"
	) {
		throw new Error("Invalid window state record");
	}
	return {
		id: value.id,
		processId: value.processId,
		visible: value.visible,
		minimized: value.minimized,
	};
}

export async function startWindowsWindowFixture(): Promise<WindowsWindowFixture> {
	const systemRoot = process.env.SystemRoot;
	if (!systemRoot || !win32.isAbsolute(systemRoot)) {
		throw new Error("Windows fixture requires an absolute SystemRoot");
	}
	const script = fileURLToPath(new URL("./fixtures/windows-window.ps1", import.meta.url));
	const title = `Launchpad native test ${randomUUID()}`;
	const child = spawn(
		win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-STA",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			script,
		],
		{
			cwd: dirname(script),
			env: { ...process.env, LAUNCHPAD_WINDOW_FIXTURE_TITLE: title },
			shell: false,
			// windowsHide also hides the first GUI window, not just the PowerShell console.
			windowsHide: false,
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	let state: WindowState | undefined;
	let revision = 0;
	let failure: Error | undefined;
	let exited = false;
	let exitDescription = "running";
	let disposing = false;
	let disposal: Promise<void> | undefined;
	let pendingOutput = "";
	let lastOutput = "";
	let stderr = "";

	function fail(error: Error) {
		failure ??= error;
	}
	function diagnostic(message: string) {
		return new Error(
			`${message}; child ${child.pid ?? "not spawned"}: ${exitDescription}\n` +
				`last stdout: ${lastOutput}\nstderr: ${stderr}`,
			{ cause: failure },
		);
	}

	// Attach immediately; failures are stored, never rejected before a caller can await them.
	child.on("error", (error) => {
		fail(error);
		if (child.pid === undefined) exited = true;
	});
	child.on("exit", (code, signal) => {
		exited = true;
		exitDescription = `exit code ${code}, signal ${signal}`;
	});
	child.on("close", () => {
		exited = true;
	});
	child.stdin.on("error", (error) => {
		if (!disposing) fail(error);
	});
	child.stdout.on("error", fail);
	child.stderr.on("error", fail);
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-4096);
	});
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		if (failure || disposing) return;
		pendingOutput += chunk;
		const lines = pendingOutput.split("\n");
		pendingOutput = lines.pop() ?? "";
		try {
			if (pendingOutput.length > 4096) throw new Error("Unterminated fixture output");
			for (const line of lines) {
				lastOutput = line.slice(-4096);
				if (line.length > 4096) throw new Error("Oversized fixture output");
				const next = parseState(line);
				if (next.processId !== child.pid) throw new Error("Fixture reported a different PID");
				if (state && (next.id !== state.id || next.processId !== state.processId)) {
					throw new Error("Fixture window identity changed");
				}
				state = next;
				revision++;
			}
		} catch (error) {
			fail(error instanceof Error ? error : new Error(String(error)));
		}
	});

	async function waitForState(expected: ExpectedState, timeout = 5000, afterRevision = revision) {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			if (failure || exited || disposing) throw diagnostic("Fixture unavailable");
			if (
				state &&
				revision > afterRevision &&
				(expected.visible === undefined || state.visible === expected.visible) &&
				(expected.minimized === undefined || state.minimized === expected.minimized)
			) {
				return;
			}
			await delay(50);
		}
		throw diagnostic(`Timed out waiting for ${JSON.stringify(expected)}`);
	}

	async function waitForExit(timeout: number) {
		const deadline = Date.now() + timeout;
		while (!exited && Date.now() < deadline) await delay(50);
		return exited;
	}

	async function stop() {
		disposing = true;
		child.stdin.end();
		if (await waitForExit(5000)) return;
		// Kill only this direct child, never a process name or unrelated GUI application.
		child.kill("SIGKILL");
		if (!(await waitForExit(5000))) throw diagnostic("Fixture did not exit after force-kill");
	}
	function dispose() {
		disposal ??= stop();
		return disposal;
	}

	try {
		await waitForState({ visible: true, minimized: false }, 20000, 0);
		if (!state) throw diagnostic("Fixture did not report its identity");
		return {
			identity: { id: state.id, processId: state.processId },
			title,
			waitForState: (expected) => waitForState(expected),
			dispose,
		};
	} catch (error) {
		try {
			await dispose();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Fixture startup and cleanup failed");
		}
		throw error;
	}
}
