// Client-side auto-refresh for <time data-relative> elements.
// Updates displayed relative timestamps every 5 seconds without a full SSE re-render.
(function () {
	function formatRelative(date) {
		var diffMs = Date.now() - date.getTime();
		var diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 5) return "just now";
		if (diffSec < 60) return diffSec + "s ago";
		var diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return diffMin + "m ago";
		var diffHour = Math.floor(diffMin / 60);
		if (diffHour < 24) return diffHour + "h ago";
		var diffDay = Math.floor(diffHour / 24);
		return diffDay + "d ago";
	}

	function refresh() {
		var elements = document.querySelectorAll("time[data-relative]");
		for (var i = 0; i < elements.length; i++) {
			var el = elements[i];
			var iso = el.getAttribute("datetime");
			if (!iso) continue;
			var date = new Date(iso);
			if (isNaN(date.getTime())) continue;
			el.textContent = formatRelative(date);
		}
	}

	setInterval(refresh, 5000);
})();
