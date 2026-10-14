# Windows window-management addon

Launchpad Monitor uses a C addon built against Node-API version 8 to enumerate and manage Windows application windows. The npm package includes these binaries:

- `prebuilds/win32-x64/windows.node`
- `prebuilds/win32-arm64/windows.node`

The arm64 binary is cross-compiled. Its runtime behavior has not yet been verified on Windows arm64; do not treat the presence of that binary as a runtime compatibility guarantee.

The loader uses Node's built-in `createRequire`. There is no install script, binary download, or source-build fallback. Users do not need Python, MSVC, Zig, or `node-gyp` to install the package. Non-Windows platforms skip window management and retain PM2 process management and logging.

Window actions use asynchronous native work rather than blocking Node's main event loop. Bringing a window to the foreground remains subject to Windows focus restrictions. Native library policies on managed machines may require signing or allowlisting the `.node` files before they can load.

## Rebuild the binaries

The build requires **official stable Zig 0.15.2**, `tar`, and HTTPS access to `nodejs.org`. Install Zig from the [official downloads](https://ziglang.org/download/). The script rejects other compiler versions. Rebuilding is a maintainer task; it is never part of package installation.

From the repository root, build both architectures:

```sh
ZIG=/path/to/zig-0.15.2 node packages/monitor/native/build.mjs
```

The package also exposes an explicit maintainer command:

```sh
ZIG=/path/to/zig-0.15.2 npm run build:native --workspace @bluecadet/launchpad-monitor
```

`ZIG` points to the compiler executable, not its containing directory. If Zig 0.15.2 is already on `PATH`, omit the environment variable. On PowerShell, set `$env:ZIG = 'C:\\path\\to\\zig-0.15.2\\zig.exe'` before running either command. `build:native` is not an install or release lifecycle script.

Use `--arch x64`, `--arch arm64`, or `--arch all` to select targets; the default is both. The script uses official Node 22.16.0 headers and Windows import libraries to build the Node-API 8 addon. This build-input version does not change the package's supported Node runtime baseline. Inputs are verified against pinned SHA-256 hashes and the official Node checksum manifest. `MONITOR_NATIVE_CACHE` optionally selects the download cache; cached inputs are also verified before use. These downloads happen only when maintainers invoke the rebuild command.

Review and commit both `windows.c` changes and rebuilt `.node` files. Cross-compilation verifies that binaries can be produced for each target, not that they work at runtime; run the Windows checks below before release.

## Verify the release package

From the repository root, build TypeScript and inspect the package manifest:

```sh
npm run build
npm pack --workspace @bluecadet/launchpad-monitor --dry-run --json
```

Check that both `prebuilds/win32-x64/windows.node` and `prebuilds/win32-arm64/windows.node` appear in the file list alongside the compiled `dist` JavaScript and declarations. Then create the tarball:

```sh
npm pack --workspace @bluecadet/launchpad-monitor
```

### Clean Windows installation

Use a fresh Windows x64 machine or VM with a supported Node version and npm, but without Python, MSVC/Visual Studio Build Tools, Zig, or a global `node-gyp`. Keep this separate from the hosted Windows CI runner, which has build tools preinstalled. Copy the packed tarball to the machine and run in PowerShell:

```powershell
New-Item -ItemType Directory -Path monitor-install-check
Set-Location monitor-install-check
npm init -y
npm config get ignore-scripts
# Must report false: do not use --ignore-scripts for this acceptance check.
npm install C:\artifacts\bluecadet-launchpad-monitor-VERSION.tgz
```

Replace the tarball path and `VERSION` with the artifact being tested. Installation must succeed with normal scripts enabled, without a compiler invocation, native build, or addon download. Keep the npm output and Node version/architecture with the verification results.

Verify that the installed addon loads and enumerates windows:

```powershell
node -e "const path = require('node:path'); const root = path.dirname(require.resolve('@bluecadet/launchpad-monitor/package.json')); const addon = require(path.join(root, 'prebuilds', 'win32-' + process.arch, 'windows.node')); console.log({ node: process.version, arch: process.arch, windows: addon.listVisibleWindows() });"
```

Loading and enumeration are only a smoke check. Repeat on real Windows arm64 before claiming arm64 runtime verification.

### Interactive window behavior

Use an interactive Windows desktop session, not a service or headless runner. Test with Launchpad managing an app whose actual PM2 process ID owns multiple visible top-level windows. An app that spawns a separate GUI child process is not a substitute for this PID-matching check.

1. Record the Node version, Windows version, CPU architecture, PM2 PID, and the test app's window titles. Start with all window flags `false`; windows should be left alone.
2. Enable only `foreground`. Restart the app and wait for the configured `windowsApi.debounceDelay` (default 3000 ms). Confirm that all visible top-level windows for that PID are targeted. Windows may refuse activation; a denied focus request alone is not a failure.
3. Repeat separately for `minimize` and `hide`. Confirm that all matched windows minimize or disappear, and that another app's windows are unaffected. Restart the app between cases so hidden windows do not contaminate later checks.
4. Enable all three flags together and verify the existing action sequence: hide, minimize, then foreground. Do not assume the final visibility or focus is guaranteed by Windows.
5. Close or terminate an app before the delayed window pass to exercise a stale PID/no-window case. Launchpad should continue without a crash. Restart it and confirm window management still works.
6. If safe in your test environment, repeat with a deliberately unresponsive app. Confirm that Launchpad's Node event loop remains responsive during native window actions. Terminate the test app afterward.

Record unexpected errors and results, including any Windows policy restrictions. Do not test against production installation apps.

CI rebuilds both Windows binaries on Ubuntu with the official Zig 0.15.2 Linux x86_64 compiler, downloaded and SHA-256-verified before use. The native drift job fails if rebuilding changes the checked-in prebuilds. This job uses only Node's built-in modules; it does not install npm dependencies or add compilation to consumer installation or release scripts.

CI also checks tarball contents and runs Windows-gated native smoke tests through the normal Vitest suite. These checks do not replace the clean installation or interactive desktop verification above.
