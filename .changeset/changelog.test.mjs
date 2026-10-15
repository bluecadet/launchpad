import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const githubInfo = require("@changesets/get-github-info");
const { getReleaseLine, getDependencyReleaseLine } = require("./changelog.cjs");
const options = { repo: "bluecadet/launchpad" };
const marker = "<!-- changeset: overview -->";
const execute = promisify(execFile);
let getInfo;

function changeset(summary, extra = {}) {
	return {
		id: "example-change",
		summary,
		releases: [{ name: "@bluecadet/launchpad", type: "patch" }],
		...extra,
	};
}

beforeEach(() => {
	getInfo = vi
		.spyOn(githubInfo, "getInfo")
		.mockRejectedValue(new Error("Unexpected GitHub lookup"));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ordinary changesets", () => {
	it("appends only the associated PR to the summary, preserving author content and code", async () => {
		getInfo.mockResolvedValue({
			links: {
				pull: "[#123](https://github.com/bluecadet/launchpad/pull/123)",
				commit: "[`abcdef0`](https://github.com/bluecadet/launchpad/commit/abcdef0)",
				user: "[@author](https://github.com/author)",
			},
		});
		const summary = [
			"Fix [author link](https://example.com) and #42",
			"",
			"  Nested paragraph  ",
			"- list item",
			"  - nested item",
			"",
			"```js",
			"const issue = '#42';  ",
			"  // author: @person, pr: #99",
			"```",
		].join("\n");
		const result = await getReleaseLine(
			changeset(summary, { commit: "abcdef0" }),
			"patch",
			options,
		);
		expect(result).toBe(
			[
				"- Fix [author link](https://example.com) and #42 ([#123](https://github.com/bluecadet/launchpad/pull/123))",
				"  ",
				"    Nested paragraph  ",
				"  - list item",
				"    - nested item",
				"  ",
				"  ```js",
				"  const issue = '#42';  ",
				"    // author: @person, pr: #99",
				"  ```",
			].join("\n"),
		);
		expect(result).not.toMatch(/abcdef0|Thanks|github.com\/author/);
		expect(getInfo).toHaveBeenCalledExactlyOnceWith({ repo: options.repo, commit: "abcdef0" });
	});

	it("preserves CRLF continuation whitespace and places the PR before the line ending", async () => {
		getInfo.mockResolvedValue({ links: { pull: "[#123](https://example.com/pull/123)" } });
		expect(
			await getReleaseLine(
				changeset("Summary\r\n\r\n  Body  \r\n", { commit: "abcdef0" }),
				"patch",
				options,
			),
		).toBe("- Summary ([#123](https://example.com/pull/123))\r\n  \r\n    Body  \r\n  ");
	});

	it("has no commit or author fallback when there is no associated PR", async () => {
		getInfo.mockResolvedValue({
			links: { pull: null, commit: "commit link", user: "author link" },
		});
		expect(await getReleaseLine(changeset("Fix it", { commit: "abcdef0" }), "patch", options)).toBe(
			"- Fix it",
		);
		expect(getInfo).toHaveBeenCalledOnce();
	});

	it("does not look up a missing commit or interpret author-written metadata", async () => {
		const summary = "Fix it\n\npr: #123\nauthor: @writer\ncommit: abcdef0";
		expect(await getReleaseLine(changeset(summary), "patch", options)).toBe(
			"- Fix it\n  \n  pr: #123\n  author: @writer\n  commit: abcdef0",
		);
		expect(getInfo).not.toHaveBeenCalled();
	});

	it("propagates lookup failures", async () => {
		const failure = new Error("GitHub unavailable");
		getInfo.mockRejectedValue(failure);
		await expect(
			getReleaseLine(changeset("Fix it", { commit: "abcdef0" }), "patch", options),
		).rejects.toBe(failure);
	});

	it.each([
		[{ name: "@bluecadet/launchpad", type: "major" }],
		[{ name: "@bluecadet/launchpad-content", type: "minor" }],
		[
			{ name: "@bluecadet/launchpad", type: "patch" },
			{ name: "@bluecadet/launchpad-content", type: "patch" },
		],
	])("uses the same format regardless of package or bump: %j", async (...releases) => {
		expect(await getReleaseLine(changeset("Same summary", { releases }), "major", options)).toBe(
			"- Same summary",
		);
		expect(getInfo).not.toHaveBeenCalled();
	});

	it("keeps a long unmarked umbrella entry as a bullet", async () => {
		const body = "A substantial paragraph. ".repeat(150);
		const summary = `Long release\n\n${body}\n\n## Author heading\n\n- Detail`;
		expect(await getReleaseLine(changeset(summary), "major", options)).toBe(
			`- Long release\n  \n  ${body}\n  \n  ## Author heading\n  \n  - Detail`,
		);
	});

	it.each([
		`Summary\n\nBody\n\n${marker}\n\nMore`,
		`Summary\n\n\`\`\`html\n${marker}\n\`\`\``,
		`\`\`\`html\n\n${marker}\n\n## Inside code\n\`\`\``,
		`~~~html\n\n${marker}\n\n## Inside code\n~~~`,
		`${marker}\n\nSummary`,
		`Summary\n${marker}\n\nBody`,
		`Summary\n\n ${marker}\n\nBody`,
		`Summary\n\n${marker}\nBody`,
	])("does not opt in for a marker outside its designated position: %s", async (summary) => {
		const result = await getReleaseLine(changeset(summary), "major", options);
		expect(result).toBe(`- ${summary.split("\n").join("\n  ")}`);
		expect(getInfo).not.toHaveBeenCalled();
	});
});

describe("explicit overviews", () => {
	it("recognizes the designated marker with CRLF and preserves body line endings", async () => {
		const body = "#### Section\r\n\r\n- Item  \r\n  - Child";
		expect(
			await getReleaseLine(
				changeset(`Summary\r\n\r\n${marker}\r\n\r\n${body}`, { commit: "abcdef0" }),
				"major",
				options,
			),
		).toBe(`\n\n**Summary**\r\n\r\n${body}\n\n`);
		expect(getInfo).not.toHaveBeenCalled();
	});

	it("preserves normal Markdown, code, and list whitespace without a lookup or generated refs", async () => {
		const body = [
			"Paragraph with [author link](https://example.com) and #42.  ",
			"",
			"#### Section",
			"##### Subsection",
			"###### Detail",
			"",
			"- first",
			"  - nested  ",
			"",
			"```js",
			"  const text = '#123';  ",
			"## Code, not a section",
			"```",
			"",
			"Tail paragraph.",
		].join("\n");
		const result = await getReleaseLine(
			changeset(`Release summary\n\n${marker}\n\n${body}`, { commit: "abcdef0" }),
			"major",
			options,
		);
		expect(result).toBe(`\n\n**Release summary**\n\n${body}\n\n`);
		expect(result).not.toContain(marker);
		expect(getInfo).not.toHaveBeenCalled();
	});

	it.each(["# Heading", "## Heading", "### Heading", "~~~md\n## Not skipped\n~~~"])(
		"rejects unsafe visible headings: %s",
		async (body) => {
			await expect(
				getReleaseLine(changeset(`Summary\n\n${marker}\n\n${body}`), "major", options),
			).rejects.toThrow(/example-change.*unsafe heading.*Use H4-H6/);
			expect(getInfo).not.toHaveBeenCalled();
		},
	);

	it("skips backtick fences until a column-zero fence of the same or greater length", async () => {
		const body = "````md\n# Code\n```\n## Still code\n`````\n\n#### Visible section";
		expect(
			await getReleaseLine(changeset(`Summary\n\n${marker}\n\n${body}`), "major", options),
		).toBe(`\n\n**Summary**\n\n${body}\n\n`);
	});

	it("resumes heading validation after a closing fence", async () => {
		await expect(
			getReleaseLine(
				changeset(`Summary\n\n${marker}\n\n\`\`\`md\n## Code\n\`\`\`\n## Visible`),
				"major",
				options,
			),
		).rejects.toThrow(/example-change.*unsafe heading: ## Visible/);
	});

	it.each(["```md\nCode", "````md\nCode\n```", "```md\nCode\n  ```"])(
		"rejects unclosed backtick fences that would absorb historical releases: %s",
		async (body) => {
			await expect(
				getReleaseLine(changeset(`Summary\n\n${marker}\n\n${body}`), "major", options),
			).rejects.toThrow(/example-change.*unclosed backtick fence.*Close it/);
		},
	);
});

describe("dependency releases", () => {
	it("returns nothing for no updates", async () => {
		expect(await getDependencyReleaseLine([changeset("Fix", { commit: "abcdef0" })], [])).toBe("");
		expect(getInfo).not.toHaveBeenCalled();
	});

	it("lists only names and new versions, without lookups or refs", async () => {
		expect(
			await getDependencyReleaseLine(
				[changeset("Fix", { commit: "abcdef0" })],
				[
					{ name: "@fixture/one", newVersion: "2.0.0" },
					{ name: "@fixture/two", newVersion: "1.2.3" },
				],
				options,
			),
		).toBe("- Updated dependencies:\n  - @fixture/one@2.0.0\n  - @fixture/two@1.2.3");
		expect(getInfo).not.toHaveBeenCalled();
	});
});

// Compatibility helper limited to the extraction algorithm verified at:
// https://github.com/changesets/action/blob/v1/src/utils.ts
// Like upstream: only column-zero backtick fences are skipped, the version text
// must match exactly, and the NEXT heading of the SAME depth ends the entry.
function extractRelease(changelog, version) {
	const headingsAndFences = /^(#{1,6})\s(.*)$|^(`{3,})/gm;
	let start;
	let end;
	for (
		let match = headingsAndFences.exec(changelog);
		match !== null;
		match = headingsAndFences.exec(changelog)
	) {
		if (match[3]) {
			const closingFence = new RegExp(`^${match[3]}`, "gm");
			closingFence.lastIndex = headingsAndFences.lastIndex;
			if (!closingFence.exec(changelog)) break;
			headingsAndFences.lastIndex = closingFence.lastIndex;
			continue;
		}
		if (match[2].trim() === version) {
			start = { index: headingsAndFences.lastIndex, depth: match[1].length };
			continue;
		}
		if (start && match[1].length === start.depth) {
			end = match.index;
			break;
		}
	}
	return changelog.slice(start?.index, end).trim();
}

it.each([
	{ label: "LF", newline: "\n" },
	{ label: "CRLF", newline: "\r\n" },
])(
	"versions a temporary workspace with the installed CLI and preserves release boundaries ($label)",
	async ({ newline }) => {
		const fixture = await mkdtemp(join(tmpdir(), "launchpad-changelog-"));
		const source = fileURLToPath(new URL(".", import.meta.url));
		const write = async (path, content) => {
			await writeFile(
				join(fixture, path),
				path.endsWith(".md") ? content.replace(/\n/g, newline) : content,
			);
		};
		const readChangelog = (directory) =>
			readFile(join(fixture, "packages", directory, "CHANGELOG.md"), "utf8");
		try {
			await mkdir(join(fixture, ".changeset"));
			await write(
				"package.json",
				JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }),
			);
			// @manypkg detects npm workspaces by the presence of this lockfile.
			await write("package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: {} }));
			await symlink(
				fileURLToPath(new URL("../node_modules", import.meta.url)),
				join(fixture, "node_modules"),
				"dir",
			);
			await copyFile(join(source, "changelog.cjs"), join(fixture, ".changeset/changelog.cjs"));
			const config = JSON.parse(await readFile(join(source, "config.json"), "utf8"));
			await write(".changeset/config.json", JSON.stringify({ ...config, format: false }));
			const packages = [
				{
					directory: "umbrella",
					name: "@bluecadet/launchpad",
					version: "3.2.1",
					dependencies: { "@fixture/feature": "^1.0.0" },
				},
				{ directory: "feature", name: "@fixture/feature", version: "1.0.0" },
				{
					directory: "dependent",
					name: "@fixture/dependent",
					version: "1.0.0",
					dependencies: { "@fixture/feature": "1.0.0" },
				},
			];
			for (const { directory, ...packageJson } of packages) {
				await mkdir(join(fixture, "packages", directory), { recursive: true });
				await write(`packages/${directory}/package.json`, JSON.stringify(packageJson));
				await write(
					`packages/${directory}/CHANGELOG.md`,
					`# ${packageJson.name}\n\n## ${packageJson.version}\n\n### Patch Changes\n\n- Previous ${directory} release\n\n## 0.9.0\n\n- Ancient ${directory} release\n`,
				);
			}
			// Changesets are intentionally untracked: git supplies no commit, so the
			// real CLI never needs a GitHub token or network access.
			await execute("git", ["init", "--initial-branch=main", fixture]);
			await execute(
				"git",
				[
					"-c",
					"user.name=Fixture",
					"-c",
					"user.email=fixture@example.com",
					"-c",
					"commit.gpgsign=false",
					"commit",
					"--allow-empty",
					"-m",
					"fixture",
				],
				{ cwd: fixture },
			);
			// Pending changesets are consumed on release; keep the test input inline.
			const overviewSource = [
				"---",
				'"@bluecadet/launchpad": major',
				"---",
				"",
				"Example major release overview",
				"",
				"<!-- changeset: overview -->",
				"",
				"A standalone introduction with [a link](https://example.com) and #42.",
				"",
				"#### Feature details",
				"",
				"A paragraph before a code sample.",
				"",
				"```markdown",
				"## Not a release boundary",
				"",
				"- A list inside code",
				"```",
				"",
				"- First improvement",
				"  - Nested detail",
				"- Second improvement",
				"",
				"#### Other improvements",
				"",
				"Another paragraph between sections.",
				"",
				"#### Before upgrading",
				"",
				"- **Configuration:** Update the example option.",
				"- **API:** Update callers. Final overview detail.",
				"",
			].join("\n");
			await write(".changeset/overview.md", overviewSource);
			await write(
				".changeset/umbrella-only.md",
				'---\n"@bluecadet/launchpad": patch\n---\n\nUmbrella-only fix\n\n## Ordinary body heading\n\nStill a bullet.\n',
			);
			await write(
				".changeset/feature-only.md",
				'---\n"@fixture/feature": minor\n---\n\nFeature-only improvement\n',
			);
			await write(
				".changeset/shared.md",
				'---\n"@bluecadet/launchpad": patch\n"@fixture/feature": patch\n---\n\nShared fix\n',
			);
			await write(
				".changeset/t-overview.md",
				`---\n"@bluecadet/launchpad": patch\n---\n\nPatch overview\n\n${marker}\n\n#### Patch details\n\nStandalone overview paragraph.\n\n- Overview detail\n`,
			);
			const cli = require.resolve("@changesets/cli/bin.js");
			const runVersion = async () => {
				try {
					return await execute(process.execPath, [cli, "version"], {
						cwd: fixture,
						timeout: 30_000,
					});
				} catch (error) {
					throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`, { cause: error });
				}
			};
			const { stdout } = await runVersion();
			expect(stdout).toContain("All files have been updated");
			const umbrella = await readChangelog("umbrella");
			const current = extractRelease(umbrella, "4.0.0");
			const overviewSummary = overviewSource.replace(/^---\n[\s\S]*?\n---\n\n/, "").trim();
			const [summary, body] = overviewSummary.split(`\n\n${marker}\n\n`);
			// Includes the entire overview fixture, especially the Before upgrading tail.
			expect(current).toContain(
				`### Major Changes\n\n**${summary}**${newline}${newline}${body.replace(/\n/g, newline)}`,
			);
			expect(current).toContain("#### Before upgrading");
			expect(current).toContain("Final overview detail.");
			expect(current).not.toContain(`- **${summary}**`);
			expect(current).not.toMatch(
				/changeset: overview|Previous|Ancient|Feature-only|Thanks|\/commit\//,
			);
			// Same bump: ordinary -> overview -> ordinary -> dependencies. Even with
			// CRLF content, blank lines must keep the overview outside adjacent lists.
			expect(current.split("### Patch Changes\n\n")[1]).toBe(
				`- Shared fix\n\n**Patch overview**${newline}${newline}#### Patch details${newline}${newline}Standalone overview paragraph.${newline}${newline}- Overview detail\n\n- Umbrella-only fix${newline}  ${newline}  ## Ordinary body heading${newline}  ${newline}  Still a bullet.\n- Updated dependencies:\n  - @fixture/feature@1.1.0`,
			);
			expect(extractRelease(umbrella, "3.2.1")).toBe(
				`### Patch Changes${newline}${newline}- Previous umbrella release`,
			);
			expect(extractRelease(umbrella, "0.9.0")).toBe("- Ancient umbrella release");
			expect(extractRelease(await readChangelog("feature"), "1.1.0")).toBe(
				"### Minor Changes\n\n- Feature-only improvement\n\n### Patch Changes\n\n- Shared fix",
			);
			expect(extractRelease(await readChangelog("dependent"), "1.0.1")).toBe(
				"### Patch Changes\n\n- Updated dependencies:\n  - @fixture/feature@1.1.0",
			);

			await write(
				".changeset/next.md",
				'---\n"@bluecadet/launchpad": patch\n---\n\nNext release only\n',
			);
			await runVersion();
			const next = await readChangelog("umbrella");
			expect(extractRelease(next, "4.0.1")).toBe("### Patch Changes\n\n- Next release only");
			expect(extractRelease(next, "4.0.0")).toBe(current);
			expect(extractRelease(next, "3.2.1")).toBe(
				`### Patch Changes${newline}${newline}- Previous umbrella release`,
			);
			expect(getInfo).not.toHaveBeenCalled();
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	},
	90_000,
);
