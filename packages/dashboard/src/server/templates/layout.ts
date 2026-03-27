import type { DashboardPage } from "../../dashboard-page.js";
import { escapeHtml } from "../../ui/helpers.js";

const HTMX_CDN = "https://unpkg.com/htmx.org@2/dist/htmx.min.js";
const HTMX_SSE_CDN = "https://unpkg.com/htmx-ext-sse@2/sse.js";

/**
 * Render the full HTML page shell.
 * Includes htmx and the SSE extension from CDN, basic styles, and nav.
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

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Launchpad Dashboard</title>
  <script src="${HTMX_CDN}" defer></script>
  <script src="${HTMX_SSE_CDN}" defer></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 14px; background: #0f0f11; color: #e2e2e2; min-height: 100vh; display: flex; flex-direction: column; }
    a { color: #7eb8f7; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .site-header { background: #18181c; border-bottom: 1px solid #2a2a30; padding: 0 1.5rem; display: flex; align-items: center; gap: 1.5rem; height: 48px; }
    .site-header__title { font-size: 15px; font-weight: 600; color: #fff; flex-shrink: 0; }
    .site-header__nav { display: flex; gap: 1rem; align-items: center; }
    .nav__link--active { color: #fff; font-weight: 600; }

    .site-main { flex: 1; padding: 1.5rem; }

    .panel-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1rem; }
    .panel { background: #18181c; border: 1px solid #2a2a30; border-radius: 8px; overflow: hidden; }
    .panel__header { padding: 0.75rem 1rem; border-bottom: 1px solid #2a2a30; }
    .panel__title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #888; }
    .panel__body { padding: 1rem; }
    .panel-error { color: #f87171; font-size: 13px; }
    .page-error { color: #f87171; }

    .badge { display: inline-block; padding: 0.15em 0.5em; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge--success { background: #14532d; color: #86efac; }
    .badge--warning { background: #713f12; color: #fde68a; }
    .badge--error { background: #450a0a; color: #fca5a5; }
    .badge--info { background: #1e3a5f; color: #93c5fd; }
    .badge--neutral { background: #27272a; color: #a1a1aa; }

    .btn { display: inline-flex; align-items: center; padding: 0.35em 0.75em; border: 1px solid #3a3a44; border-radius: 5px; background: #27272a; color: #e2e2e2; font-size: 13px; cursor: pointer; }
    .btn:hover { background: #3a3a44; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2a30; color: #888; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    .data-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #1e1e22; }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table .empty { color: #666; font-style: italic; }

    .page-nav { margin-bottom: 1.5rem; }
    .page-nav__title { font-size: 13px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .page-nav__list { list-style: none; display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .page-nav__list li a { display: inline-block; padding: 0.35em 0.75em; border: 1px solid #2a2a30; border-radius: 5px; background: #18181c; color: #e2e2e2; }
    .page-nav__list li a:hover { background: #27272a; text-decoration: none; }

    .empty-state { color: #666; font-style: italic; }
  </style>
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
