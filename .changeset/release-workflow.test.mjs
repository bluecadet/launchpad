import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = await readRepositoryFile(".github/workflows/release.yml");
const config = JSON.parse(await readRepositoryFile(".changeset/config.json"));

describe("release workflow contract", () => {
	it("pairs the supported v2 action with its publish-script and Git push inputs", () => {
		expect(workflow).toContain(
			"uses: changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2\n" +
				"        with:\n" +
				"          publish-script: npm run release\n" +
				"          push-with-git-cli: true",
		);
		expect(workflow).not.toMatch(/^\s*publish:/m);
	});

	it("serializes runs for the workflow and ref without cancelling an active release", () => {
		expect(workflow).toMatch(
			/^concurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false$/m,
		);
	});

	it("keeps the build-before-publish command fail-fast without masking its exit status", async () => {
		const { scripts } = JSON.parse(await readRepositoryFile("package.json"));
		// Assert the command without ever executing release or publish, even in dry-run mode.
		// npm inherits CHANGESETS_OUTPUT, && stops on build failure, and the final
		// command's failure reaches the action without a pipeline or success fallback.
		expect(scripts.release).toBe("npm run build && changeset publish");
		expect(workflow).not.toMatch(/^\s*continue-on-error:/m);
	});

	it("runs CI for changesets tooling and release-workflow-only pushes", async () => {
		const ciWorkflow = await readRepositoryFile(".github/workflows/ci.yml");
		const pushPaths = ciWorkflow.match(/\n {4}paths:\n((?: {6}- .+\n)+)/)?.[1];
		expect(pushPaths).toContain('      - ".changeset/**"\n');
		expect(pushPaths).toContain('      - ".github/workflows/release.yml"\n');
	});
});

// The installed CLI's git-tag command only creates/checks Git tags. Its remote
// checks are confined to a disposable local bare repository, never GitHub/npm.
it.each([
	{ label: "repository private-package policy", tagPrivate: config.privatePackages.tag },
	{ label: "private packages opted into tagging", tagPrivate: true },
	{ label: "no eligible packages", tagPrivate: false, onlyPrivate: true },
])(
	"writes structured git-tag events and leaves repeats empty: $label",
	async ({ tagPrivate, onlyPrivate }) => {
		const temporary = await mkdtemp(join(tmpdir(), "launchpad-release-workflow-"));
		const workspace = join(temporary, "workspace");
		const remote = join(temporary, "origin.git");
		const packages = [
			{ name: "@fixture/widget", version: "1.2.3" },
			{ name: "@fixture/tool", version: "4.5.6" },
			{ name: "@fixture/internal", version: "7.8.9", private: true },
		].filter((pkg) => !onlyPrivate || pkg.private);
		const env = {
			...process.env,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: join(temporary, "no-global-git-config"),
			GIT_TERMINAL_PROMPT: "0",
		};
		const git = (args) => execute("git", args, { cwd: workspace, env, timeout: 10_000 });
		const write = (path, value) => writeFile(join(workspace, path), JSON.stringify(value));
		try {
			await mkdir(join(workspace, ".changeset"), { recursive: true });
			await write("package.json", {
				name: "release-workflow-fixture",
				private: true,
				workspaces: ["packages/*"],
			});
			// @manypkg identifies npm workspaces using the lockfile, without installing anything.
			await write("package-lock.json", { lockfileVersion: 3, packages: {} });
			await write(".changeset/config.json", {
				...config,
				privatePackages: {
					version: tagPrivate || config.privatePackages.version,
					tag: tagPrivate,
				},
			});
			for (const [index, pkg] of packages.entries()) {
				await mkdir(join(workspace, "packages", String(index)), { recursive: true });
				await write(`packages/${index}/package.json`, pkg);
			}
			await git(["init", "--initial-branch=main"]);
			await git(["config", "user.name", "Release Fixture"]);
			await git(["config", "user.email", "fixture@example.com"]);
			await git(["config", "commit.gpgsign", "false"]);
			await git(["config", "tag.gpgsign", "false"]);
			await git(["add", "."]);
			await git(["commit", "-m", "fixture release"]);
			await git(["init", "--bare", remote]);
			await git(["remote", "add", "origin", remote]);
			const commit = (await git(["rev-parse", "HEAD"])).stdout.trim();
			const expectedEvents = packages
				.filter((pkg) => !pkg.private || tagPrivate)
				.map((pkg) => ({
					type: "git-tag",
					tag: `${pkg.name}@${pkg.version}`,
					packageName: pkg.name,
				}))
				.sort((left, right) => left.tag.localeCompare(right.tag));
			const expectedTags = expectedEvents.map((event) => event.tag).sort();
			const cli = require.resolve("@changesets/cli/bin.js");
			for (const run of ["first", "repeat"]) {
				const output = join(temporary, `${run}.ndjson`);
				await execute(process.execPath, [cli, "git-tag"], {
					cwd: workspace,
					env: { ...env, CHANGESETS_OUTPUT: output },
					timeout: 30_000,
				});
				const report = await readFile(output, "utf8");
				const events = report
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
					.sort((left, right) => left.tag.localeCompare(right.tag));
				expect(events).toEqual(run === "first" ? expectedEvents : []);
				if (run === "repeat" || expectedEvents.length === 0) expect(report).toBe("");
				const tags = (await git(["tag", "--list"])).stdout.trim().split("\n").filter(Boolean);
				expect(tags.sort()).toEqual(expectedTags);
				for (const tag of tags) {
					expect((await git(["rev-parse", `${tag}^{commit}`])).stdout.trim()).toBe(commit);
				}
			}
			// git-tag must not push anything, even to this disposable local remote.
			expect((await git(["ls-remote", "--tags", "origin"])).stdout).toBe("");
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
	60_000,
);
