# @bluecadet/launchpad-scaffold

## 2.1.0-ansible.1

## 2.1.0-ansible.0

### Minor Changes

- [`ce6c89baeae1bc3a6988be38c9c8375fb3fe4ead`](https://github.com/bluecadet/launchpad/commit/ce6c89baeae1bc3a6988be38c9c8375fb3fe4ead) Thanks [@claytercek](https://github.com/claytercek)! - Refactor scaffold to ansible

## 2.0.0

### Major Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989) Thanks [@claytercek](https://github.com/claytercek)! - **Plugin API and Content Package Updates:**

  - Add basic support for Plugin API across `content`, `monitor`, and `core` packages.
  - Implement full support for plugins in `content` package.
  - Refactor `content` sources to be functions.
  - Refactor `content` transforms and media-downloader to be plugins.
  - Implement `neverthrow` for error handling in `content` package.
  - Add unit tests for `content` package.
  - Fully remove credentials API (superseded by dotenv config)

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`9252b2489f1e7170223c2c2bfaffe2202d32b59a`](https://github.com/bluecadet/launchpad/commit/9252b2489f1e7170223c2c2bfaffe2202d32b59a), [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935), [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989), [`75622fbcf94d84717d6c1107799b5d745828a7a6`](https://github.com/bluecadet/launchpad/commit/75622fbcf94d84717d6c1107799b5d745828a7a6), [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0), [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef), [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741), [`2c2866a77482a18759a4fdacafcb7e6493db6dbb`](https://github.com/bluecadet/launchpad/commit/2c2866a77482a18759a4fdacafcb7e6493db6dbb), [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1)]:
  - @bluecadet/launchpad-utils@2.0.0

## 2.0.0-next.3

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- Updated dependencies [[`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935)]:
  - @bluecadet/launchpad-utils@2.0.0-next.5

## 2.0.0-next.2

### Patch Changes

- [#178](https://github.com/bluecadet/launchpad/pull/178) [`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- Updated dependencies [[`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758), [`a6f330947de66ba5b95abdf06f66ecfaca67bd0a`](https://github.com/bluecadet/launchpad/commit/a6f330947de66ba5b95abdf06f66ecfaca67bd0a)]:
  - @bluecadet/launchpad-utils@2.0.0-next.4

## 2.0.0-next.1

### Patch Changes

- [#170](https://github.com/bluecadet/launchpad/pull/170) [`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.2

## 2.0.0-next.0

### Major Changes

- [#164](https://github.com/bluecadet/launchpad/pull/164) [`3d40d3c3f47afe080f642b3188f5e62a529a891b`](https://github.com/bluecadet/launchpad/commit/3d40d3c3f47afe080f642b3188f5e62a529a891b) Thanks [@github-actions](https://github.com/apps/github-actions)! - **Plugin API and Content Package Updates:**

  - Add basic support for Plugin API across `content`, `monitor`, and `core` packages.
  - Implement full support for plugins in `content` package.
  - Refactor `content` sources to be functions.
  - Refactor `content` transforms and media-downloader to be plugins.
  - Implement `neverthrow` for error handling in `content` package.
  - Add unit tests for `content` package.
  - Fully remove credentials API (superseded by dotenv config)

- [#165](https://github.com/bluecadet/launchpad/pull/165) [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Patch Changes

- Updated dependencies [[`3d40d3c3f47afe080f642b3188f5e62a529a891b`](https://github.com/bluecadet/launchpad/commit/3d40d3c3f47afe080f642b3188f5e62a529a891b), [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de)]:
  - @bluecadet/launchpad-utils@2.0.0-next.0

## 1.8.1

### Patch Changes

- [#142](https://github.com/bluecadet/launchpad/pull/142) [`b0433e74e0616ee07d07987b80b4bafdcfbcbd5e`](https://github.com/bluecadet/launchpad/commit/b0433e74e0616ee07d07987b80b4bafdcfbcbd5e) Thanks [@claytercek](https://github.com/claytercek)! - fix missing files in scaffold

## 1.8.0

### Minor Changes

- [#124](https://github.com/bluecadet/launchpad/pull/124) [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd) Thanks [@claytercek](https://github.com/claytercek)! - support js configs

### Patch Changes

- [#122](https://github.com/bluecadet/launchpad/pull/122) [`9e6d6d4`](https://github.com/bluecadet/launchpad/commit/9e6d6d417310697d29e6fb6656e87ff3d2bc3205) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Adds script to disable Windows setup prompts

- [#118](https://github.com/bluecadet/launchpad/pull/118) [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa) Thanks [@claytercek](https://github.com/claytercek)! - Generate d.ts declaration files for intellisense, and fix all type errors.

- Updated dependencies [[`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72), [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd), [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1), [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa)]:
  - @bluecadet/launchpad-utils@1.5.0

## 1.7.2

### Patch Changes

- [`5a98dbb`](https://github.com/bluecadet/launchpad/commit/5a98dbbd8eb839cc266f43ddc9aefa6af8e38fac) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Fixes scaffold issue when running on portable drives

## 1.7.1

### Patch Changes

- [#102](https://github.com/bluecadet/launchpad/pull/102) [`9efdf12`](https://github.com/bluecadet/launchpad/commit/9efdf12230d31fef8fe9c5708dbe7eb145c398e2) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added win 11 unpin start menu warning (not supported)

## 1.7.0

### Minor Changes

- [#98](https://github.com/bluecadet/launchpad/pull/98) [`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added eslint and reformated code

### Patch Changes

- Updated dependencies [[`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee)]:
  - @bluecadet/launchpad-utils@1.4.0

## 1.6.0

### Minor Changes

- [#96](https://github.com/bluecadet/launchpad/pull/96) [`852ed2f`](https://github.com/bluecadet/launchpad/commit/852ed2f0e10f00210f91ec37e7d087f7cebe7911) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Fixes powerplan selection and powershell7 compatibility

## 1.5.0

### Minor Changes

- [#71](https://github.com/bluecadet/launchpad/pull/71) [`acd0ef8`](https://github.com/bluecadet/launchpad/commit/acd0ef86ef3af15c04c769b02db2ff5cff00bcff) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added ability to disable 3 & 4 finger touch gestures

## 1.4.0

### Minor Changes

- [#68](https://github.com/bluecadet/launchpad/pull/68) [`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

### Patch Changes

- Updated dependencies [[`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3)]:
  - @bluecadet/launchpad-utils@1.3.0

## 1.3.0

### Minor Changes

- [`42eff47`](https://github.com/bluecadet/launchpad/commit/42eff47933462c808f931d9e6578b6d47015b410) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added Windows Update Orchestrator and Medic services to scaffold scrpits

## 1.2.1

### Patch Changes

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1

## 1.2.1-next.0

### Patch Changes

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1-next.0

## 1.2.0

### Minor Changes

- [#39](https://github.com/bluecadet/launchpad/pull/39) [`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23) Thanks [@github-actions](https://github.com/apps/github-actions)! - Changeset monorepo restructure

### Patch Changes

- Updated dependencies [[`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23)]:
  - @bluecadet/launchpad-utils@1.2.0

## 1.1.0

### Minor Changes

- [#28](https://github.com/bluecadet/launchpad/pull/28) [`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Start using [🦋 Changesets](https://github.com/changesets/changesets) to manage releases.

### Patch Changes

- Updated dependencies [[`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc)]:
  - @bluecadet/launchpad-utils@1.1.0
