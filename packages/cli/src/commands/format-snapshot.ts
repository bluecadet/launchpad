import type { Row, Section, StatusSnapshot, Tone } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";

export function formatSnapshot(snapshot: StatusSnapshot): string {
	let output = `${chalk.bold("Launchpad Status:")}\n`;
	output += `  Uptime: ${formatUptime(snapshot.header.uptimeMs)}\n`;

	for (const section of snapshot.sections) {
		output += "\n";
		output += formatSection(section);
	}

	return output;
}

function formatSection(section: Section): string {
	let output = `${chalk.bold(section.title)}:\n`;
	for (const row of section.rows) {
		output += formatRow(row, 2);
	}
	return output;
}

function formatRow(row: Row, indent: number): string {
	const pad = " ".repeat(indent);

	if (row.type === "kv") {
		const value = applyToneColor(row.value, row.tone);
		return `${pad}${row.label}: ${value}\n`;
	}

	if (row.type === "list") {
		let output = `${pad}${row.label}:\n`;
		for (const item of row.items) {
			output += formatListItem(item, indent + 2);
		}
		return output;
	}

	// text row
	const text = applyToneColor(row.text, row.tone);
	return `${pad}${text}\n`;
}

function formatListItem(item: Row, indent: number): string {
	const pad = " ".repeat(indent);

	if (item.type === "kv") {
		const icon = toneIcon(item.tone);
		return `${pad}${icon} ${item.label}: ${item.value}\n`;
	}

	if (item.type === "list") {
		let output = `${pad}${item.label}:\n`;
		for (const child of item.items) {
			output += formatListItem(child, indent + 2);
		}
		return output;
	}

	// text item
	const text = applyToneColor(item.text, item.tone);
	return `${pad}${text}\n`;
}

function toneIcon(tone: Tone | undefined): string {
	switch (tone) {
		case "ok":
			return chalk.green("✓");
		case "error":
			return chalk.red("✗");
		case "warn":
			return chalk.yellow("●");
		default:
			return chalk.gray("○");
	}
}

function applyToneColor(text: string, tone: Tone | undefined): string {
	switch (tone) {
		case "ok":
			return chalk.green(text);
		case "warn":
			return chalk.yellow(text);
		case "error":
			return chalk.red(text);
		default:
			return text;
	}
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ${hours % 24}h ${minutes % 60}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}
