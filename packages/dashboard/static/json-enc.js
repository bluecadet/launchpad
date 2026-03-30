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
		return JSON.stringify(parameters);
	},
});
