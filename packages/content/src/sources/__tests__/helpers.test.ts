import { describe, expect, it, vi } from "vitest";
import { setupMSWServer } from "./helpers.js";

setupMSWServer();

describe("source HTTP test server", () => {
	it("rejects unhandled requests instead of reaching the network", async () => {
		const reportError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await expect(fetch("https://unhandled.example.invalid/source")).rejects.toThrow();
			expect(reportError).toHaveBeenCalledWith(
				expect.stringContaining("intercepted a request without a matching request handler"),
			);
		} finally {
			reportError.mockRestore();
		}
	});
});
