import { escapeHtml } from "./helpers.js";
import type { DataTableOptions } from "./types.js";

/**
 * Render an HTML table from an array of row objects.
 * Column order defaults to keys from the first row.
 *
 * @example
 * dataTable([{ name: "web", status: "online", pid: 1234 }])
 * dataTable(rows, { columns: ["name", "status"] })
 */
export function dataTable(rows: Record<string, unknown>[], opts: DataTableOptions = {}): string {
	if (rows.length === 0) {
		return '<table class="data-table"><tbody><tr><td class="empty">No data</td></tr></tbody></table>';
	}

	const columns = opts.columns ?? Object.keys(rows[0] ?? {});
	const caption = opts.caption ? `<caption>${escapeHtml(opts.caption)}</caption>` : "";

	const headers = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("");

	const bodyRows = rows
		.map((row) => {
			const cells = columns.map((col) => `<td>${escapeHtml(String(row[col] ?? ""))}</td>`).join("");
			return `<tr>${cells}</tr>`;
		})
		.join("");

	return `<table class="data-table">${caption}<thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}
