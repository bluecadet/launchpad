/**
 * Shared types for the UI helpers module.
 */
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";

export type { BaseCommand };

/** A wrapper for pre-escaped HTML that bypasses auto-escaping in the html`` tag. */
export type RawHtml = { readonly __brand: "RawHtml"; readonly value: string };

export type StatusLevel = "success" | "warning" | "error" | "info" | "neutral";

export type CommandButtonOptions = {
	confirm?: string;
	disabled?: boolean;
	class?: string;
};

export type DataTableOptions = {
	/** Explicit column order. Defaults to keys from the first row. */
	columns?: string[];
	/** Caption shown above the table */
	caption?: string;
};

export type UiHelpers = {
	/**
	 * Tagged template literal for building HTML strings.
	 * Interpolated values are auto-escaped. Wrap trusted HTML with raw().
	 */
	html(strings: TemplateStringsArray, ...values: unknown[]): string;
	/**
	 * Mark a string as trusted HTML to bypass escaping in the html`` tag.
	 * Only use this for HTML you have generated or sanitized yourself.
	 */
	raw(value: string): RawHtml;
	/** HTML-escape a plain string. */
	escapeHtml(value: string): string;
	/**
	 * Render a button that dispatches a command via POST /commands when clicked.
	 * No client JS required — wired with htmx attributes.
	 */
	commandButton(label: string, command: BaseCommand, opts?: CommandButtonOptions): string;
	/** Render a styled status badge. */
	statusBadge(text: string, level: StatusLevel): string;
	/** Render an HTML table from an array of row objects. */
	dataTable(rows: Record<string, unknown>[], opts?: DataTableOptions): string;
	/** Format a date as a human-readable relative time string (e.g. "2m ago"). */
	relativeTime(date: Date | string | undefined | null): string;
	/** Format a millisecond duration as a compact string (e.g. "1.2s", "350ms"). */
	formatDuration(ms: number): string;
};
