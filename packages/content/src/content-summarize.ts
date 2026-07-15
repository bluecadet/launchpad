import { formatTimeAgo } from "@bluecadet/launchpad-utils/status-format";
import type { Row, Section, Tone } from "@bluecadet/launchpad-utils/types";
import type { ContentState, SourceFetchState } from "./content-state.js";

function versionCount(count: number): string {
	return `${count} version${count === 1 ? "" : "s"}`;
}

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

export function buildContentSection(contentState: ContentState, now: Date = new Date()): Section {
	const rows: Row[] = [{ type: "kv", label: "Phase", value: contentState.phase }];

	const { versioning } = contentState;
	if (versioning) {
		const { retention } = contentState;
		const versionRow: Row =
			retention?.versionId && retention.promotedAt
				? {
						type: "kv",
						label: "Version",
						value: `${retention.versionId} · promoted ${formatTimeAgo(retention.promotedAt, now)}`,
						tone: "ok",
					}
				: { type: "kv", label: "Version", value: "none yet", tone: "neutral" };
		const retainedCount = retention?.retainedCount ?? 0;
		const pendingDeleteCount = retention?.pendingDeleteCount ?? 0;
		const retainedValue = `${versionCount(retainedCount + pendingDeleteCount)} (keep ${versioning.keepVersions}${
			pendingDeleteCount > 0 ? `, ${pendingDeleteCount} pending delete` : ""
		})`;

		rows.push(versionRow, {
			type: "kv",
			label: "Retained",
			value: retainedValue,
			tone: pendingDeleteCount > 0 ? "warn" : "ok",
		});

		if (retention && retention.acks.length > 0) {
			const items: Row[] = retention.acks.map((ack) => ({
				type: "kv",
				label: ack.consumerId,
				value: `${ack.versionId} · ${ack.fresh ? "" : "expired "}${formatTimeAgo(ack.ackedAt, now)}`,
				tone: ack.fresh ? "ok" : "neutral",
			}));
			rows.push({ type: "list", label: "Acks", items });
		}
	}

	const { sources } = contentState;
	if (sources && Object.keys(sources).length > 0) {
		const items: Row[] = Object.entries(sources).map(([sourceId, sourceState]) =>
			sourceRow(sourceId, sourceState),
		);
		rows.push({ type: "list", label: "Sources", items });
	}

	return { name: "content", order: 20, title: "Content", rows };
}
