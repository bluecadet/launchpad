import { describe, expect, it } from "vitest";
import { serializeJSON } from "../json-serializer.js";

describe("serializeJSON", () => {
	describe("plain values", () => {
		it("round-trips plain nested objects and arrays via JSON.parse", () => {
			const value = {
				id: "msg-0",
				count: 2,
				tags: ["a", "b", "c"],
				nested: { active: true, items: [1, 2, { deep: "value" }] },
			};

			expect(JSON.parse(serializeJSON(value))).toEqual(value);
		});
	});

	describe("Error handling", () => {
		it("serializes an Error to name and message", () => {
			const error = new Error("something broke");
			const parsed = JSON.parse(serializeJSON(error));

			expect(parsed).toEqual({ name: "Error", message: "something broke" });
		});

		it("serializes a nested Error cause recursively", () => {
			const rootCause = new Error("root cause");
			const wrapped = new Error("wrapped error", { cause: rootCause });
			const parsed = JSON.parse(serializeJSON(wrapped));

			expect(parsed.name).toBe("Error");
			expect(parsed.message).toBe("wrapped error");
			expect(parsed.cause).toEqual({ name: "Error", message: "root cause" });
		});

		it("omits cause when the Error has none", () => {
			const error = new Error("no cause here");
			const parsed = JSON.parse(serializeJSON(error));

			expect("cause" in parsed).toBe(false);
		});
	});

	describe("bigint", () => {
		it("serializes a bigint to its decimal string", () => {
			const parsed = JSON.parse(serializeJSON({ big: 42n }));

			expect(parsed.big).toBe("42");
		});
	});

	describe("unserializable placeholders", () => {
		it("replaces a Map with a placeholder", () => {
			const parsed = JSON.parse(serializeJSON({ value: new Map([["a", 1]]) }));

			expect(parsed.value).toBe("[unserializable: map]");
		});

		it("replaces a Set with a placeholder", () => {
			const parsed = JSON.parse(serializeJSON({ value: new Set([1, 2]) }));

			expect(parsed.value).toBe("[unserializable: set]");
		});

		it("replaces a function with a placeholder", () => {
			const parsed = JSON.parse(serializeJSON({ value: () => {} }));

			expect(parsed.value).toBe("[unserializable: function]");
		});

		it("replaces a symbol with a placeholder", () => {
			const parsed = JSON.parse(serializeJSON({ value: Symbol("secret") }));

			expect(parsed.value).toBe("[unserializable: symbol]");
		});
	});

	describe("Date", () => {
		it("serializes a Date to its ISO string", () => {
			const date = new Date("2024-01-01T00:00:00.000Z");
			const parsed = JSON.parse(serializeJSON({ when: date }));

			expect(parsed.when).toBe(date.toISOString());
		});
	});

	describe("circular references", () => {
		it("does not throw and replaces the repeated reference with a placeholder", () => {
			type Node = { id: string; self?: Node };
			const node: Node = { id: "root" };
			node.self = node;

			expect(() => serializeJSON(node)).not.toThrow();

			const parsed = JSON.parse(serializeJSON(node));
			expect(parsed.id).toBe("root");
			expect(parsed.self).toBe("[unserializable: circular]");
		});

		it("does not throw on a self-referencing Error cause", () => {
			const error = new Error("looping");
			error.cause = error;

			expect(() => serializeJSON(error)).not.toThrow();

			const parsed = JSON.parse(serializeJSON(error));
			expect(parsed.message).toBe("looping");
			expect(parsed.cause).toBe("[unserializable: circular]");
		});
	});

	describe("top-level values JSON.stringify can't represent", () => {
		it("returns a valid JSON string for a top-level undefined", () => {
			const serialized = serializeJSON(undefined);

			expect(() => JSON.parse(serialized)).not.toThrow();
			expect(JSON.parse(serialized)).toBeNull();
		});
	});
});
