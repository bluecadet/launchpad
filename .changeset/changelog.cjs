const githubInfo = require("@changesets/get-github-info");

// A code fence is not a plain-text summary, even if its contents start with the marker.
const overviewPrefix =
	/^(?![ \t]*(?:`{3,}|~{3,}))([^\r\n]+)(\r?\n)\2<!-- changeset: overview -->\2\2/;

function checkOverviewHeadings(body, changesetId) {
	// Match the release extractor's column-zero backtick fences, not tilde fences:
	// https://github.com/changesets/action/blob/v1/src/utils.ts
	const headingsAndFences = /^(#{1,6})\s(.*)$|^(`{3,})/gm;
	for (
		let match = headingsAndFences.exec(body);
		match !== null;
		match = headingsAndFences.exec(body)
	) {
		if (match[3]) {
			const closingFence = new RegExp(`^${match[3]}`, "gm");
			closingFence.lastIndex = headingsAndFences.lastIndex;
			if (!closingFence.exec(body)) {
				throw new Error(
					`Changeset "${changesetId}" overview contains an unclosed backtick fence. Close it with at least ${match[3].length} backticks so release extraction cannot include historical versions.`,
				);
			}
			headingsAndFences.lastIndex = closingFence.lastIndex;
			continue;
		}

		if (match[1].length <= 3) {
			throw new Error(
				`Changeset "${changesetId}" overview contains an unsafe heading: ${match[0]}. Use H4-H6 (#### through ######) below Changesets' generated H3 heading.`,
			);
		}
	}
}

async function getReleaseLine(changeset, _type, options) {
	const overview = overviewPrefix.exec(changeset.summary);
	if (overview) {
		const body = changeset.summary.slice(overview[0].length);
		checkOverviewHeadings(body, changeset.id);
		// apply-release-plan counts LF-only separator hints before trimming entries.
		// Keep these outer hints LF even when the author's Markdown uses CRLF.
		const paragraphBreak = overview[2].repeat(2);
		return `\n\n**${overview[1]}**${paragraphBreak}${body}\n\n`;
	}

	const [summary] = changeset.summary.split(/\r?\n/, 1);
	const continuation = changeset.summary.slice(summary.length).replace(/\r?\n/g, "$&  ");
	const info = changeset.commit
		? await githubInfo.getCommitInfo({ repo: options.repo, commit: changeset.commit })
		: undefined;
	const pull = info?.pull?.markdownLink;
	const suffix = pull ? ` (${pull})` : "";
	return `- ${summary}${suffix}${continuation}`;
}

async function getDependencyReleaseLine(_changesets, dependenciesUpdated) {
	if (dependenciesUpdated.length === 0) return "";
	return [
		"- Updated dependencies:",
		...dependenciesUpdated.map((dependency) => `  - ${dependency.name}@${dependency.newVersion}`),
	].join("\n");
}

module.exports = { getReleaseLine, getDependencyReleaseLine };
