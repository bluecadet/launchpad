import { registry } from "@bluecadet/launchpad-utils/panel-registry";
import type { DashboardPage } from "../../dashboard-page.js";
import { escapeHtml } from "../../ui/helpers.js";

/**
 * Render the full HTML page shell.
 * Scripts and styles are sourced from the registry — plugins contribute them during setup().
 */
export function renderLayout(
	title: string,
	body: string,
	pages: DashboardPage[],
	activePageId: string | null = null,
): string {
	const navLinks =
		pages.length > 0
			? pages
					.map((p) => {
						const href = p.path ?? `/pages/${p.id}`;
						const active = p.id === activePageId ? ' class="nav__link--active"' : "";
						return `<a href="${escapeHtml(href)}"${active}>${escapeHtml(p.title)}</a>`;
					})
					.join("\n        ")
			: "";

	const styleLinks = registry
		.getStyles()
		.map((s) => `  <link rel="stylesheet" href="${escapeHtml(s.url)}">`)
		.join("\n");

	const scriptTags = registry
		.getScripts()
		.map((s) => `  <script src="${escapeHtml(s.url)}"${s.defer ? " defer" : ""}></script>`)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Launchpad Dashboard</title>
${styleLinks}
${scriptTags}
</head>
<body>
  <header class="site-header">
    <a href="/" class="site-header__title">Launchpad Dashboard</a>
    <nav class="site-header__nav">
      ${navLinks}
    </nav>
  </header>
  <main class="site-main" hx-ext="sse" sse-connect="/sse">
    ${body}
  </main>
</body>
</html>`;
}
