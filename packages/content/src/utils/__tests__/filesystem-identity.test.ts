import {
	chmod,
	link,
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesystemIdentity } from "../filesystem-identity.js";

vi.unmock("node:fs");
vi.unmock("fs");
vi.unmock("fs/promises");

vi.mock("node:fs/promises", async (importOriginal) => {
	const filesystem = await importOriginal<typeof import("node:fs/promises")>();
	// Keep real filesystem behavior, but observe transient probes even when chmod
	// cannot deny writes (Windows ACLs or an elevated test process).
	return {
		...filesystem,
		mkdtemp: vi.fn(filesystem.mkdtemp),
		writeFile: vi.fn(filesystem.writeFile),
	};
});

describe("filesystem identities (real filesystem)", () => {
	let directory: string;
	let caseSensitive: boolean;
	const readonlyDirectories: string[] = [];

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-identity-"));
		const probe = path.join(directory, "case-probe");
		await writeFile(probe, "probe");
		try {
			const lower = await stat(probe);
			const upper = await stat(path.join(directory, "CASE-PROBE"));
			caseSensitive = lower.ino !== upper.ino || lower.dev !== upper.dev;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			caseSensitive = true;
		} finally {
			await rm(probe);
		}
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const readonlyDirectory of readonlyDirectories.splice(0)) {
			await chmod(readonlyDirectory, 0o755);
		}
		await rm(directory, { recursive: true, force: true });
	});

	async function makeReadonly(filePath: string): Promise<void> {
		readonlyDirectories.push(filePath);
		await chmod(filePath, 0o555);
	}

	async function expectedFixtureIdentity(identity: FilesystemIdentity, ...components: string[]) {
		// Only fixture components use the measured sensitivity. Ancestors (including
		// the physical drive root) retain their independently resolved identities.
		const canonicalDirectory = await identity.resolve(directory);
		return path.join(
			canonicalDirectory,
			...components.map((component) =>
				caseSensitive ? component : component.normalize("NFC").toLowerCase(),
			),
		);
	}

	function watchProbeWrites() {
		return {
			createProbe: vi.mocked(mkdtemp).mockClear(),
			writeProbe: vi.mocked(writeFile).mockClear(),
		};
	}

	function expectNoProbeWrites(probes: ReturnType<typeof watchProbeWrites>) {
		expect(probes.createProbe).not.toHaveBeenCalled();
		expect(probes.writeProbe).not.toHaveBeenCalled();
	}

	it("resolves readonly inputs and their symlink/case aliases without creating probes", async () => {
		const inputs = path.join(directory, "ReadOnlyInputs");
		const input = path.join(inputs, "Input.TXT");
		await mkdir(inputs);
		await writeFile(input, "input");
		await chmod(input, 0o444);
		await symlink(input, path.join(directory, "input-alias"), "file");
		await makeReadonly(inputs);

		const probes = watchProbeWrites();
		const identity = new FilesystemIdentity();
		const expected = await expectedFixtureIdentity(identity, "ReadOnlyInputs", "Input.TXT");
		await expect(identity.resolve(input)).resolves.toBe(expected);
		await expect(identity.resolve(path.join(directory, "input-alias"))).resolves.toBe(expected);
		const caseAlias = await identity.resolve(path.join(inputs, "input.txt"));
		expect(caseAlias === expected).toBe(!caseSensitive);
		await expect(readdir(inputs)).resolves.toEqual(["Input.TXT"]);
		expectNoProbeWrites(probes);
	});

	it("retains canonical existing prefixes when measuring missing suffixes in readonly directories", async () => {
		const inputs = path.join(directory, "ReadOnlyInputs");
		await mkdir(inputs);
		await writeFile(path.join(inputs, "CaseProof"), "input");
		await makeReadonly(inputs);
		const probes = watchProbeWrites();
		const identity = new FilesystemIdentity();
		const canonicalPrefix = await identity.resolve(inputs);
		expect(canonicalPrefix).toBe(await expectedFixtureIdentity(identity, "ReadOnlyInputs"));
		const original = await identity.resolve(path.join(inputs, "Future", "Output"));
		const alias = await identity.resolve(path.join(inputs, "future", "output"));
		expect(original.startsWith(`${canonicalPrefix}${path.sep}`)).toBe(true);
		expect(original === alias).toBe(!caseSensitive);
		await expect(readdir(inputs)).resolves.toEqual(["CaseProof"]);
		expectNoProbeWrites(probes);
	});

	it("does not need case probes for existing empty readonly directories", async () => {
		const inputs = path.join(directory, "123");
		await mkdir(inputs);
		await makeReadonly(inputs);
		const probes = watchProbeWrites();
		const identity = new FilesystemIdentity();
		const expected = await expectedFixtureIdentity(identity, "123");
		await expect(identity.resolve(inputs)).resolves.toBe(expected);
		await expect(readdir(inputs)).resolves.toEqual([]);
		expectNoProbeWrites(probes);
	});

	it("resolves /etc/hosts using only read-only physical evidence", async ({ skip }) => {
		let expected: string;
		try {
			expected = await realpath("/etc/hosts");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return skip();
			throw error;
		}
		const probes = watchProbeWrites();
		await expect(new FilesystemIdentity().resolve("/etc/hosts")).resolves.toBe(expected);
		expectNoProbeWrites(probes);
	});

	it("preserves the physical filesystem root in canonical identities", async () => {
		const root = path.parse(await realpath(directory)).root;
		await expect(new FilesystemIdentity().resolve(root)).resolves.toBe(root);
	});

	it.runIf(process.platform === "win32")(
		"canonicalizes drive-letter aliases for roots and existing or missing fixture paths",
		async () => {
			const physicalDirectory = await realpath(directory);
			const root = path.parse(physicalDirectory).root;
			const lowerRoot = `${root.charAt(0).toLowerCase()}${root.slice(1)}`;
			const upperRoot = `${root.charAt(0).toUpperCase()}${root.slice(1)}`;
			expect(lowerRoot).not.toBe(upperRoot);
			for (const aliasRoot of [lowerRoot, upperRoot]) {
				await expect(new FilesystemIdentity().resolve(aliasRoot)).resolves.toBe(root);
			}

			const relativeDirectory = path.relative(root, physicalDirectory);
			const filename = "Future.TXT";
			const aliases = [lowerRoot, upperRoot].map((aliasRoot) =>
				path.join(aliasRoot, relativeDirectory, filename),
			);
			const expected = await expectedFixtureIdentity(new FilesystemIdentity(), filename);
			for (const alias of aliases) {
				await expect(new FilesystemIdentity().resolve(alias)).resolves.toBe(expected);
			}
			await writeFile(path.join(directory, filename), "input");
			for (const alias of aliases) {
				await expect(new FilesystemIdentity().resolve(alias)).resolves.toBe(expected);
			}
		},
	);

	it.each(["Photo.jpg", ".LAUNCHPAD"])(
		"keeps %s identities stable when missing paths are created",
		async (name) => {
			const filePath = path.join(directory, name);
			const identity = new FilesystemIdentity();
			const missing = await identity.resolve(filePath);
			if (name === ".LAUNCHPAD") await mkdir(filePath);
			else await writeFile(filePath, "output");
			await expect(identity.resolve(filePath)).resolves.toBe(missing);
			await expect(new FilesystemIdentity().resolve(filePath)).resolves.toBe(missing);
		},
	);

	it("preserves missing metadata prefix identities after mixed-case ancestors are created", async () => {
		const identity = new FilesystemIdentity();
		const metadata = path.join(directory, ".LAUNCHPAD");
		const cache = path.join(metadata, "Cache");
		const output = path.join(cache, "Photo.jpg");
		const missingMetadata = await identity.resolve(metadata);
		const missingCache = await identity.resolve(cache);
		const missingOutput = await identity.resolve(output);
		await mkdir(cache, { recursive: true });
		await expect(identity.resolve(output)).resolves.toBe(missingOutput);
		await expect(new FilesystemIdentity().resolve(output)).resolves.toBe(missingOutput);
		await writeFile(output, "output");
		await expect(identity.resolve(output)).resolves.toBe(missingOutput);
		await expect(new FilesystemIdentity().resolve(output)).resolves.toBe(missingOutput);
		expect(missingOutput.startsWith(`${missingMetadata}${path.sep}`)).toBe(true);
		expect(missingOutput.startsWith(`${missingCache}${path.sep}`)).toBe(true);
	});

	it("measures empty writable directories without leaving probe files", async () => {
		const probes = watchProbeWrites();
		const identity = new FilesystemIdentity();
		const original = await identity.resolve(path.join(directory, "Future"));
		const alias = await identity.resolve(path.join(directory, "future"));
		expect(original === alias).toBe(!caseSensitive);
		expect(probes.createProbe).toHaveBeenCalledTimes(1);
		expect(probes.writeProbe).toHaveBeenCalledTimes(1);
		await expect(readdir(directory)).resolves.toEqual([]);
	});

	it("does not mistake a case-alias symlink for an insensitive filesystem", async ({ skip }) => {
		if (!caseSensitive) return skip();
		await writeFile(path.join(directory, "a"), "input");
		await symlink("a", path.join(directory, "A"), "file");
		const identity = new FilesystemIdentity();
		expect(await identity.resolve(path.join(directory, "Future"))).not.toBe(
			await identity.resolve(path.join(directory, "future")),
		);
		await expect(readdir(directory)).resolves.toEqual(["A", "a"]);
	});

	it("does not mistake case-alias hard links for an insensitive filesystem", async ({ skip }) => {
		if (!caseSensitive) return skip();
		await writeFile(path.join(directory, "a"), "input");
		await link(path.join(directory, "a"), path.join(directory, "A"));
		await makeReadonly(directory);
		const identity = new FilesystemIdentity();
		expect(await identity.resolve(path.join(directory, "Future"))).not.toBe(
			await identity.resolve(path.join(directory, "future")),
		);
		await expect(readdir(directory)).resolves.toEqual(["A", "a"]);
	});
});
