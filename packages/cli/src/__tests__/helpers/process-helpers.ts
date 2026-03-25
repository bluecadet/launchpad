import { fork } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ServerHandle = {
	socketPath: string;
	pidFile: string;
	runDir: string;
	teardown: () => Promise<void>;
};

export async function spawnServerProcess(timeoutMs = 8_000): Promise<ServerHandle> {
	const runDir = path.join(os.tmpdir(), `lp-test-${process.pid}-${Date.now()}`);
	fs.mkdirSync(runDir, { recursive: true });

	const socketPath = path.join(runDir, "ipc.sock");
	const pidFile = path.join(runDir, "launchpad.pid");

	const fixtureFile = fileURLToPath(new URL("../fixtures/server-process.ts", import.meta.url));

	const serverProcess = fork(fixtureFile, [], {
		env: { ...process.env, LP_SOCKET_PATH: socketPath, LP_PID_FILE: pidFile },
		stdio: "pipe",
		execArgv: ["--experimental-strip-types", "--experimental-vm-modules"],
	});

	serverProcess.stderr?.on("data", (data: Buffer) => process.stderr.write(data));

	await waitForSocket(socketPath, timeoutMs);

	return {
		socketPath,
		pidFile,
		runDir,
		teardown: async () => {
			serverProcess.kill("SIGTERM");
			await new Promise<void>((resolve) => serverProcess.on("exit", () => resolve()));
			try {
				fs.unlinkSync(socketPath);
			} catch {}
			try {
				fs.rmSync(runDir, { recursive: true });
			} catch {}
		},
	};
}

export async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await canConnect(socketPath)) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Socket never became available: ${socketPath}`);
}

function canConnect(socketPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const s = net.createConnection(socketPath);
		s.once("connect", () => {
			s.end();
			resolve(true);
		});
		s.once("error", () => resolve(false));
	});
}
