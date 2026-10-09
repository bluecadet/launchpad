import type { Row, Section } from "@bluecadet/launchpad-utils/types";
import type { ObservabilityState } from "./observability-state.js";

export function buildObservabilitySection(state: ObservabilityState): Section {
	const rows: Row[] = [];

	const destinationEntries = Object.entries(state.destinations ?? {});
	if (destinationEntries.length > 0) {
		const items: Row[] = destinationEntries.flatMap(([name, destination]) =>
			Object.entries(destination).map(([signal, signalState]) => ({
				type: "kv",
				label: `${name} (${signal})`,
				value:
					signalState.status === "unknown"
						? "unknown — waiting for first successful export"
						: signalState.status === "ok"
							? `ok — ${signalState.totalPushed} pushed`
							: `${signalState.status} — ${signalState.lastError ?? `${signalState.queueSize} batches queued`}`,
				tone:
					signalState.status === "unknown"
						? "neutral"
						: signalState.status === "ok"
							? "ok"
							: signalState.status === "degraded"
								? "warn"
								: "error",
			})),
		);
		rows.push({ type: "list", label: "Destinations", items });
	} else {
		const transportEntries = Object.entries(state.transports);
		if (transportEntries.length === 0) {
			rows.push({ type: "text", text: "No transports configured", tone: "neutral" });
		} else {
			const items: Row[] = transportEntries.map(([name, t]) => ({
				type: "kv",
				label: name,
				value:
					t.status === "ok"
						? `ok — ${t.totalPushed} pushed${t.lastPushAt ? `, last ${t.lastPushAt.toISOString()}` : ""}`
						: t.status === "degraded"
							? `degraded — buffer: ${t.bufferSize} batches`
							: `failing — ${t.lastError ?? "unknown error"}`,
				tone: t.status === "ok" ? "ok" : t.status === "degraded" ? "warn" : "error",
			}));
			rows.push({ type: "list", label: "Transports", items });
		}
	}

	return { name: "observability", order: 20, title: "Observability", rows };
}
