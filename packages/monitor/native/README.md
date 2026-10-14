# Windows window-management addon

Launchpad Monitor uses a C addon targeting Node-API 8 to enumerate and manage Windows application windows. The package bundles `prebuilds/win32-x64/windows.node` and `prebuilds/win32-arm64/windows.node`.

Installation requires no Python, MSVC, Zig, or `node-gyp`. There is no install script, binary download, or source-build fallback. Non-Windows platforms skip window management but retain PM2 process management and logging.

## Rebuild

Maintainers need official stable Zig **0.17.0** on `PATH`; other versions are rejected. No Windows SDK or separate LLVM tools are needed. Run from the repository root:

```sh
zig build --build-file packages/monitor/native/build.zig
# Cross-compile and link without replacing prebuilds:
zig build --build-file packages/monitor/native/build.zig test
```

Alternatively, `npm run build:native --workspace @bluecadet/launchpad-monitor` rebuilds both architectures. These commands are never run during package installation or release.

The default build replaces both checked-in prebuilds only after both compile successfully. Use `-Darch=x64` or `-Darch=arm64` for one target. Commit native changes with both rebuilt binaries; cross-compilation does not validate Windows runtime behavior. CI checks for prebuild drift.

`build.zig.zon` pins Node 22.16.0 headers without changing the supported Node runtime baseline. Zig generates import libraries from `node-api.def`; add newly used Node-API functions there, retain `LIBRARY node.exe`, and exclude addon registration exports.

Zig fetches and verifies headers from `nodejs.org`, then caches them. After an online build, rebuild without fetching from the repository root:

```sh
zig build --build-file packages/monitor/native/build.zig --system packages/monitor/native/zig-pkg
```

Remove obsolete `-Dnode-cache` arguments and unset `MONITOR_NATIVE_CACHE`; the old cache is not reused.

## Windows tests

On Windows x64 or arm64 with matching Node architecture, run from the repository root:

```sh
npx vitest run packages/monitor/src/utils/__tests__/windows-native.windows.test.ts
```

The tests load the real bundled addon and create a disposable Windows Forms window. They require built-in Windows PowerShell 5.1 and .NET, with policies allowing Windows Forms and `Add-Type`; no native build tools are needed.

Coverage includes enumeration, exact titles, independently observed minimize/hide state, mismatched owner PIDs, and stale descriptors. Non-Windows platforms skip; addon-load or fixture failures on supported Windows fail. Windows CI covers x64; arm64 needs a separate run.

## Before release

```sh
npm run build
npm pack --workspace @bluecadet/launchpad-monitor --dry-run --json
npm pack --workspace @bluecadet/launchpad-monitor
```

- Confirm the tarball contains both prebuilds and compiled `dist` JavaScript/declarations. Install it on clean Windows without build tools, with normal npm scripts enabled; verify addon loading and enumeration. Hosted CI does not prove toolchain-free installation.
- On an interactive desktop, use a disposable app with multiple visible top-level windows owned by the actual PM2 PID, not a GUI child PID. Check flags off, each action separately, combined hide/minimize/foreground order, and stale/no-window cases; leave unrelated windows unchanged. Restart between cases and wait for `windowsApi.debounceDelay` (default 3000 ms). If safe, verify Node stays responsive with an unresponsive test app.
- Foreground activation is best-effort under Windows focus restrictions; denied focus alone is not failure. Managed machines may require addon signing or allowlisting. Record Node/Windows versions, architecture, PIDs, and results.

A previous ARM64 prebuild passed a clean Windows ARM64 VM smoke check on Node v24.22.0 before generated import libraries were adopted. That historical check does not validate the current artifacts; both architectures still need Windows runtime validation.
