import { ok } from "neverthrow";
import { vi } from "vitest";

// memfs descriptors are not OS descriptors; native lease integration is tested in utils.
vi.mock("@bluecadet/launchpad-utils/native-file-lease", () => ({
	acquireNativeFileLease: vi.fn(() => ok({ release: vi.fn(() => ok(undefined)) })),
}));
