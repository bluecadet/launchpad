import type { RawHtml } from "./types.js";

const HTML_ESCAPE_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/**
 * HTML-escape a plain string value.
 */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

/**
 * Mark a string as trusted HTML to bypass auto-escaping in the html`` tag.
 * Only use this for HTML you have generated or sanitized yourself.
 */
export function raw(value: string): RawHtml {
	return { __brand: "RawHtml", value } as RawHtml;
}

function isRawHtml(value: unknown): value is RawHtml {
	return (
		typeof value === "object" &&
		value !== null &&
		"__brand" in value &&
		(value as Record<string, unknown>).__brand === "RawHtml"
	);
}

function interpolate(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (isRawHtml(value)) return value.value;
	return escapeHtml(String(value));
}

/**
 * Tagged template literal for building HTML strings safely.
 * Interpolated values are auto-escaped unless wrapped with raw().
 *
 * @example
 * html`<p>Hello ${username}</p>`
 * html`<div>${raw(trustedHtmlString)}</div>`
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	let result = "";
	for (let i = 0; i < strings.length; i++) {
		result += strings[i];
		if (i < values.length) {
			result += interpolate(values[i]);
		}
	}
	return result;
}
