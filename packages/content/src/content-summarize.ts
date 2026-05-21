import type { Row, Section, Tone } from "@bluecadet/launchpad-utils/types";
import type { ContentState, SourceFetchState } from "./content-state.js";

function sourceRow(sourceId: string, sourceState: SourceFetchState): Row {
	let value: string;
	let tone: Tone;

	if (sourceState.state === "pending") {
		value = "Pending";
		tone = "neutral";
	} else if (sourceState.state === "fetching") {
		value = "Fetching";
		tone = "warn";
	} else if (sourceState.state === "success") {
		const duration = (sourceState.duration / 1000).toFixed(1);
		value = `Success (${duration}s)`;
		tone = "ok";
	} else {
		value = `Error: ${sourceState.error.message}`;
		if (sourceState.restored) {
			value += " (restored from backup)";
		}
		tone = "error";
	}

	return { type: "kv", label: sourceId, value, tone };
}

export function buildContentSection(contentState: ContentState): Section {
	const rows: Row[] = [{ type: "kv", label: "Phase", value: contentState.phase }];

	const { sources } = contentState;
	if (sources && Object.keys(sources).length > 0) {
		const items: Row[] = Object.entries(sources).map(([sourceId, sourceState]) =>
			sourceRow(sourceId, sourceState),
		);
		rows.push({ type: "list", label: "Sources", items });
	}

	return { name: "content", order: 20, title: "Content", rows };
}
