import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { escapeHtml } from "./helpers.js";
import type { CommandButtonOptions } from "./types.js";

/**
 * Render a button that dispatches a Launchpad command via POST /commands when clicked.
 * Wired with htmx attributes — no client JS required.
 *
 * @example
 * commandButton("Restart App", { type: "monitor.restart", appNames: ["web"] })
 * commandButton("Stop All", { type: "monitor.stop" }, { confirm: "Stop all apps?" })
 */
export function commandButton(
	label: string,
	command: BaseCommand,
	opts: CommandButtonOptions = {},
): string {
	// Attribute uses single quotes, so only single quotes inside the JSON need escaping.
	// Double quotes are safe as-is and must not be entity-encoded for htmx to parse correctly.
	const vals = JSON.stringify(command).replace(/'/g, "&#39;");
	const confirmAttr = opts.confirm ? ` hx-confirm="${escapeHtml(opts.confirm)}"` : "";
	const disabledAttr = opts.disabled ? " disabled" : "";
	const classAttr = opts.class ? ` class="${escapeHtml(opts.class)}"` : ' class="btn"';

	return `<button hx-post="/commands" hx-ext="json-enc" hx-vals='${vals}' hx-swap="none"${confirmAttr}${disabledAttr}${classAttr}>${escapeHtml(label)}</button>`;
}
