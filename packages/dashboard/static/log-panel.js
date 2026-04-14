(function () {
	"use strict";

	/** @type {string} */
	let searchTerm = "";

	/** @type {Set<string>} */
	let activeLevels = new Set(["error", "warn", "info", "debug", "verbose"]);

	/** @type {ReturnType<typeof setTimeout> | null} */
	let debounceTimer = null;

	/**
	 * Returns true if the scroll container is near the bottom.
	 * @param {HTMLElement} container
	 */
	function isNearBottom(container) {
		return container.scrollHeight - container.scrollTop - container.clientHeight < 60;
	}

	/**
	 * Whether a log entry should be visible given current filter state.
	 * @param {HTMLElement} entry
	 */
	function matchesFilters(entry) {
		if (!activeLevels.has(entry.dataset.level ?? "")) return false;
		if (searchTerm && !entry.textContent.toLowerCase().includes(searchTerm)) return false;
		return true;
	}

	/**
	 * Show/hide all entries in a container based on current filter state.
	 * @param {HTMLElement} container
	 */
	function applyFilters(container) {
		for (const entry of container.querySelectorAll(".log-entry")) {
			/** @type {HTMLElement} */ (entry).hidden = !matchesFilters(/** @type {HTMLElement} */ (entry));
		}
	}

	/**
	 * Trim the oldest entries when the container exceeds its configured max.
	 * @param {HTMLElement} container
	 */
	function trimEntries(container) {
		const max = Number(container.dataset.maxEntries) || 500;
		while (container.children.length > max) {
			container.firstElementChild?.remove();
		}
	}

	// ─── Event delegation ────────────────────────────────────────────────────────
	// Listeners live on document so they survive panel body replacements by htmx.

	document.addEventListener("input", (evt) => {
		const input = evt.target;
		if (!(input instanceof HTMLInputElement) || !input.classList.contains("log-search")) return;
		const container = input.closest(".log-panel")?.querySelector(".log-panel__entries");
		if (!(container instanceof HTMLElement)) return;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			searchTerm = input.value.toLowerCase();
			applyFilters(container);
		}, 250);
	});

	document.addEventListener("click", (evt) => {
		const btn = evt.target;
		if (!(btn instanceof HTMLElement) || !btn.classList.contains("log-level-btn")) return;
		const container = btn.closest(".log-panel")?.querySelector(".log-panel__entries");
		if (!(container instanceof HTMLElement)) return;
		btn.classList.toggle("log-level-btn--active");
		const level = btn.dataset.level ?? "";
		if (btn.classList.contains("log-level-btn--active")) {
			activeLevels.add(level);
		} else {
			activeLevels.delete(level);
		}
		applyFilters(container);
	});

	// ─── Live entry streaming ─────────────────────────────────────────────────────

	document.addEventListener("htmx:sseMessage", (evt) => {
		const detail = /** @type {CustomEvent} */ (evt).detail;
		if (detail?.type !== "log:entry") return;

		const container = document.querySelector(".log-panel__entries");
		if (!(container instanceof HTMLElement)) return;

		const shouldScroll = isNearBottom(container);

		const template = document.createElement("template");
		template.innerHTML = detail.data;
		const entry = template.content.firstElementChild;
		if (!(entry instanceof HTMLElement)) return;

		entry.hidden = !matchesFilters(entry);
		container.appendChild(entry);
		trimEntries(container);

		if (shouldScroll) {
			container.scrollTop = container.scrollHeight;
		}
	});

	// ─── SSE reconnect ────────────────────────────────────────────────────────────
	// When SSE reconnects the panel body is replaced with freshly rendered HTML
	// (empty search input, all levels active). Reset JS state to match.

	document.addEventListener("htmx:sseOpen", () => {
		searchTerm = "";
		activeLevels = new Set(["error", "warn", "info", "debug", "verbose"]);
	});
})();
