import { describe, expect, it } from "vitest";
import { dataTable } from "../data-table.js";

describe("dataTable", () => {
	it("renders an empty-state row when given an empty array", () => {
		const result = dataTable([]);
		expect(result).toContain("No data");
	});

	it("renders headers from the first row's keys by default", () => {
		const result = dataTable([{ name: "web", status: "online" }]);
		expect(result).toContain("<th>name</th>");
		expect(result).toContain("<th>status</th>");
	});

	it("renders cell values", () => {
		const result = dataTable([{ name: "web", status: "online" }]);
		expect(result).toContain("<td>web</td>");
		expect(result).toContain("<td>online</td>");
	});

	it("respects the columns option for ordering and selection", () => {
		const result = dataTable([{ name: "web", status: "online", pid: 123 }], {
			columns: ["status", "name"],
		});
		expect(result).toContain("<th>status</th>");
		expect(result).toContain("<th>name</th>");
		expect(result).not.toContain("<th>pid</th>");
		// Status column appears before name column in the output
		expect(result.indexOf("<th>status</th>")).toBeLessThan(result.indexOf("<th>name</th>"));
	});

	it("renders multiple rows", () => {
		const result = dataTable([
			{ name: "web", status: "online" },
			{ name: "api", status: "offline" },
		]);
		expect(result).toContain("<td>web</td>");
		expect(result).toContain("<td>api</td>");
	});

	it("renders a caption when provided", () => {
		const result = dataTable([{ x: 1 }], { caption: "My Table" });
		expect(result).toContain("<caption>My Table</caption>");
	});

	it("escapes HTML in cell values", () => {
		const result = dataTable([{ name: "<script>alert(1)</script>" }]);
		expect(result).toContain("&lt;script&gt;");
		expect(result).not.toContain("<script>");
	});

	it("renders empty string for undefined cell values", () => {
		const result = dataTable([{ name: "web", status: undefined }]);
		expect(result).toContain("<td></td>");
	});
});
