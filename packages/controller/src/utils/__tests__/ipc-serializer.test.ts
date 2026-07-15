import { describe, expect, it } from "vitest";
import { IPCSerializer } from "../ipc-serializer.js";

describe("IPCSerializer", () => {
	describe("serialize and deserialize", () => {
		it("should serialize and deserialize primitives", () => {
			const primitives = ["string", 42, true, null, undefined];

			for (const value of primitives) {
				const serialized = IPCSerializer.serialize(value);
				const deserialized = IPCSerializer.deserialize(serialized);
				expect(deserialized).toEqual(value);
			}
		});

		it("should serialize and deserialize objects", () => {
			const obj = { name: "test", value: 42, nested: { key: "value" } };
			const serialized = IPCSerializer.serialize(obj);
			const deserialized = IPCSerializer.deserialize(serialized);

			expect(deserialized).toEqual(obj);
		});

		it("should serialize and deserialize arrays", () => {
			const arr = [1, "two", { three: 3 }, true, null];
			const serialized = IPCSerializer.serialize(arr);
			const deserialized = IPCSerializer.deserialize(serialized);

			expect(deserialized).toEqual(arr);
		});

		it("should serialize and deserialize complex nested structures", () => {
			const complex = {
				users: [
					{ id: 1, name: "Alice", active: true },
					{ id: 2, name: "Bob", active: false },
				],
				metadata: {
					count: 2,
					tags: ["a", "b", "c"],
					settings: { debug: true, timeout: 5000 },
				},
			};
			const serialized = IPCSerializer.serialize(complex);
			const deserialized = IPCSerializer.deserialize(serialized);

			expect(deserialized).toEqual(complex);
		});

		it("should serialize and deserialize Dates", () => {
			const date = new Date("2024-01-01T00:00:00Z");
			const serialized = IPCSerializer.serialize(date);
			const deserialized = IPCSerializer.deserialize(serialized);

			expect(deserialized).toEqual(date);
			expect(deserialized instanceof Date).toBe(true);
		});
	});

	describe("error handling", () => {
		it("should serialize and deserialize Error objects", () => {
			const error = new Error("Test error message");
			const serialized = IPCSerializer.serialize(error);
			const deserialized = IPCSerializer.deserialize(serialized) as Error;

			expect(deserialized instanceof Error).toBe(true);
			expect(deserialized.message).toBe("Test error message");
		});

		it("should serialize and deserialize error message", () => {
			const error = new Error("Test error with message");
			const serialized = IPCSerializer.serialize(error);
			const deserialized = IPCSerializer.deserialize(serialized) as Error;

			expect(deserialized.message).toBe("Test error with message");
			expect(deserialized instanceof Error).toBe(true);
		});

		it("should serialize and deserialize errors with cause property", () => {
			const cause = new Error("Original error");
			const error = new Error("Wrapped error", { cause });
			const serialized = IPCSerializer.serialize(error);
			const deserialized = IPCSerializer.deserialize(serialized) as Error;

			expect(deserialized.message).toBe("Wrapped error");
			expect(deserialized.cause).toBeDefined();
			expect((deserialized.cause as Error).message).toBe("Original error");
		});

		it("should serialize and deserialize deeply nested error causes", () => {
			const cause1 = new Error("Root cause");
			const cause2 = new Error("Intermediate error", { cause: cause1 });
			const error = new Error("Top level error", { cause: cause2 });

			const serialized = IPCSerializer.serialize(error);
			const deserialized = IPCSerializer.deserialize(serialized) as Error;

			expect(deserialized.message).toBe("Top level error");
			expect((deserialized.cause as Error).message).toBe("Intermediate error");
			expect(((deserialized.cause as Error).cause as Error).message).toBe("Root cause");
		});

		it("should include stacktrace on nested errors", () => {
			const cause = new Error("Root cause");
			const error = new Error("Top level error", { cause: cause });

			const serialized = IPCSerializer.serialize(error);
			const deserialized = IPCSerializer.deserialize(serialized) as Error;

			expect(deserialized.stack).toBe(error.stack);
			expect((deserialized.cause as Error).stack).toBe(cause.stack);
		});

		it("should handle TypeError and other error types", () => {
			const errors = [
				new TypeError("Type mismatch"),
				new RangeError("Out of range"),
				new SyntaxError("Invalid syntax"),
				new ReferenceError("Undefined variable"),
			];

			for (const error of errors) {
				const serialized = IPCSerializer.serialize(error);
				const deserialized = IPCSerializer.deserialize(serialized) as Error;

				expect(deserialized instanceof Error).toBe(true);
				expect(deserialized.message).toBe(error.message);
			}
		});

		it("should serialize objects containing errors", () => {
			const obj = {
				id: "msg-0",
				type: "error",
				error: new Error("Command failed"),
			};
			const serialized = IPCSerializer.serialize(obj);
			const deserialized = IPCSerializer.deserialize(serialized) as any;

			expect(deserialized.id).toBe("msg-0");
			expect(deserialized.type).toBe("error");
			expect(deserialized.error instanceof Error).toBe(true);
			expect(deserialized.error.message).toBe("Command failed");
		});

		it("should serialize errors in objects with other properties", () => {
			const errorResponse = {
				id: "msg-1",
				type: "error",
				error: new Error("Operation failed"),
				code: "OP_FAILED",
				statusCode: 500,
			};

			const serialized = IPCSerializer.serialize(errorResponse);
			const deserialized = IPCSerializer.deserialize(serialized) as any;

			expect(deserialized.id).toBe("msg-1");
			expect(deserialized.type).toBe("error");
			expect(deserialized.error.message).toBe("Operation failed");
			expect(deserialized.code).toBe("OP_FAILED");
			expect(deserialized.statusCode).toBe(500);
		});
	});

	describe("non-POJO payloads (serialize must never throw)", () => {
		// Mirrors airtable's AirtableError, which does not extend Error.
		class FakeAirtableError {
			constructor(
				public error: string,
				public message: string,
				public statusCode: number,
			) {}
		}

		it("should serialize errors whose cause does not extend Error", () => {
			const cause = new FakeAirtableError("AUTHENTICATION_REQUIRED", "Invalid API key", 401);
			const error = new Error("Failed to fetch source airtable", { cause });

			const serialized = IPCSerializer.serialize(error);
			const deserialized = IPCSerializer.deserialize(serialized) as Error;

			expect(deserialized.message).toBe("Failed to fetch source airtable");
			expect(deserialized.cause instanceof Error).toBe(true);
			expect((deserialized.cause as Error).message).toBe("Invalid API key");
			expect((deserialized.cause as Error).name).toBe("FakeAirtableError");
		});

		it("should serialize event payloads containing deeply nested non-Error error objects", () => {
			const payload = {
				name: "content:document:error",
				data: {
					sourceId: "airtable",
					documentId: "stories",
					error: new Error("Failed to write data", {
						cause: new FakeAirtableError("AUTHENTICATION_REQUIRED", "Invalid API key", 401),
					}),
				},
			};

			const deserialized = IPCSerializer.deserialize(IPCSerializer.serialize(payload)) as any;

			expect(deserialized.data.error.message).toBe("Failed to write data");
			expect(deserialized.data.error.cause.message).toBe("Invalid API key");
		});

		it("should flatten arbitrary class instances to plain objects", () => {
			class Custom {
				constructor(public id: string) {}
			}

			const serialized = IPCSerializer.serialize({ items: [new Custom("a"), new Custom("b")] });
			const deserialized = IPCSerializer.deserialize(serialized) as any;

			expect(deserialized.items).toEqual([{ id: "a" }, { id: "b" }]);
		});

		it("should replace functions and symbols with placeholders", () => {
			const payload = {
				callback: function doThing() {},
				token: Symbol("secret"),
			};

			const deserialized = IPCSerializer.deserialize(IPCSerializer.serialize(payload)) as any;

			expect(deserialized.callback).toBe("[function doThing]");
			expect(deserialized.token).toBe("Symbol(secret)");
		});

		it("should replace promises with placeholders", () => {
			const payload = { pending: Promise.resolve(42) };

			const deserialized = IPCSerializer.deserialize(IPCSerializer.serialize(payload)) as any;

			expect(deserialized.pending).toBe("[promise]");
		});

		it("should handle cyclic payloads containing non-POJOs", () => {
			class Node {
				next?: Node;
				constructor(public id: string) {}
			}
			const a = new Node("a");
			const b = new Node("b");
			a.next = b;
			b.next = a;

			const deserialized = IPCSerializer.deserialize(IPCSerializer.serialize({ root: a })) as any;

			expect(deserialized.root.id).toBe("a");
			expect(deserialized.root.next.id).toBe("b");
			expect(deserialized.root.next.next).toBe(deserialized.root);
		});

		it("should preserve Dates, Maps, and Sets when sanitizing", () => {
			class Wrapper {
				when = new Date("2024-01-01T00:00:00Z");
				tags = new Set(["a", "b"]);
				lookup = new Map([["key", new Wrapper2()]]);
			}
			class Wrapper2 {
				value = 42;
			}

			const deserialized = IPCSerializer.deserialize(
				IPCSerializer.serialize({ data: new Wrapper() }),
			) as any;

			expect(deserialized.data.when).toEqual(new Date("2024-01-01T00:00:00Z"));
			expect(deserialized.data.tags).toEqual(new Set(["a", "b"]));
			expect(deserialized.data.lookup.get("key")).toEqual({ value: 42 });
		});

		it("should never throw, even for payloads with throwing getters", () => {
			const payload = {
				get boom(): string {
					throw new Error("getter exploded");
				},
			};

			expect(() => IPCSerializer.serialize(payload)).not.toThrow();
			const deserialized = IPCSerializer.deserialize(IPCSerializer.serialize(payload));
			expect(typeof deserialized).toBe("string");
			expect(deserialized).toContain("unserializable IPC payload");
		});
	});

	describe("complex real-world scenarios", () => {
		it("should handle IPC response with complex data", () => {
			const response = {
				id: "msg-0",
				type: "state",
				data: {
					system: { mode: "task", uptime: 12345 },
					apps: [
						{ id: "app1", status: "running", pid: 1234 },
						{ id: "app2", status: "stopped", pid: null },
					],
					timestamp: new Date("2024-01-01T00:00:00Z"),
				},
			};

			const serialized = IPCSerializer.serialize(response);
			const deserialized = IPCSerializer.deserialize(serialized);

			expect(deserialized).toEqual(response);
		});

		it("should handle response with error cause chain", () => {
			const originalError = new Error("Database connection failed");
			const wrappedError = new Error("Failed to fetch data", { cause: originalError });
			const response = {
				id: "msg-1",
				type: "error",
				error: wrappedError,
			};

			const serialized = IPCSerializer.serialize(response);
			const deserialized = IPCSerializer.deserialize(serialized) as any;

			expect(deserialized.error.message).toBe("Failed to fetch data");
			expect((deserialized.error.cause as Error).message).toBe("Database connection failed");
		});
	});

	describe("deserialization edge cases", () => {
		it("should throw on invalid JSON", () => {
			expect(() => IPCSerializer.deserialize("not valid json")).toThrow();
		});

		it("should throw on incomplete JSON", () => {
			expect(() => IPCSerializer.deserialize('{"key": "value"')).toThrow();
		});

		it("should throw on empty string", () => {
			expect(() => IPCSerializer.deserialize("")).toThrow();
		});
	});
});
