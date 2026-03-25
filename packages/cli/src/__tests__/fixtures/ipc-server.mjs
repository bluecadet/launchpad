/**
 * Minimal IPC server fixture for integration tests.
 * Plain JS — no TypeScript compilation or experimental flags needed.
 *
 * Writes its own PID to LP_PID_FILE so the test can verify isProcessRunning(),
 * listens on LP_SOCKET_PATH for IPC messages, and exits cleanly on shutdown.
 */
import { createServer } from "node:net";
import { writeFileSync } from "node:fs";
import { stringify, parse } from "devalue";

const { LP_SOCKET_PATH: socketPath, LP_PID_FILE: pidFile } = process.env;

if (!socketPath || !pidFile) {
	process.stderr.write("LP_SOCKET_PATH and LP_PID_FILE must be set\n");
	process.exit(1);
}

// Write own PID so getDaemonPid() sees a real, running process.
writeFileSync(pidFile, String(process.pid));

const server = createServer((socket) => {
	let buf = "";
	socket.on("data", (data) => {
		buf += data.toString();
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			const msg = parse(line);
			socket.write(`${stringify({ id: msg.id, type: "ack" })}\n`);
			if (msg.type === "shutdown") {
				// Small delay to let the ack be flushed before exiting.
				setTimeout(() => process.exit(0), 50);
			}
		}
	});
});

server.listen(socketPath);
process.on("SIGTERM", () => process.exit(0));
