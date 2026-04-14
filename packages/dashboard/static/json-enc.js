// Vendored htmx extension: encodes hx-vals / hx-include data as application/json
// instead of application/x-www-form-urlencoded, preserving arrays and nested objects.
// Source: https://github.com/bigskysoftware/htmx-extensions/tree/main/src/json-enc
htmx.defineExtension("json-enc", {
	onEvent: function (name, evt) {
		if (name === "htmx:configRequest") {
			evt.detail.headers["Content-Type"] = "application/json";
		}
	},
	encodeParameters: function (xhr, parameters, _elt) {
		xhr.overrideMimeType("text/json");
		// parameters is a FormData (or FormData proxy) in htmx 2.x.
		// Object.fromEntries() loses multi-value keys, so iterate entries manually
		// and collect multiple values for the same key as an array.
		if (parameters && typeof parameters.entries === "function") {
			const obj = {};
			for (const [key, value] of parameters.entries()) {
				if (Object.prototype.hasOwnProperty.call(obj, key)) {
					if (!Array.isArray(obj[key])) {
						obj[key] = [obj[key]];
					}
					obj[key].push(value);
				} else {
					obj[key] = value;
				}
			}
			return JSON.stringify(obj);
		}
		return JSON.stringify(parameters);
	},
});
