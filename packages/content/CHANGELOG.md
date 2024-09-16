# @bluecadet/launchpad-content

## 1.14.0

### Minor Changes

- [`4bafb91969f7768b00f8ed353eb7b86b611dff9e`](https://github.com/bluecadet/launchpad/commit/4bafb91969f7768b00f8ed353eb7b86b611dff9e) Thanks [@claytercek](https://github.com/claytercek)! - Add more control over how `launchpad content` encodes URL characters when writing to disk. Added new `encodeChars` option to content options.

## 1.13.1

### Patch Changes

- [#153](https://github.com/bluecadet/launchpad/pull/153) [`ae7bd38cbc16d404902db90e615ec897af1b5e6d`](https://github.com/bluecadet/launchpad/commit/ae7bd38cbc16d404902db90e615ec897af1b5e6d) Thanks [@claytercek](https://github.com/claytercek)! - Fix event warning in media downloader. Also switch from `got` to `ky` for fetching (recommended by maintainers).

- [#153](https://github.com/bluecadet/launchpad/pull/153) [`ae7bd38cbc16d404902db90e615ec897af1b5e6d`](https://github.com/bluecadet/launchpad/commit/ae7bd38cbc16d404902db90e615ec897af1b5e6d) Thanks [@claytercek](https://github.com/claytercek)! - Update default backup path to avoid polluting the launchpad directory with empty timestamp folders

## 1.13.0

### Minor Changes

- [`b7fa754826aa9201da0f02ed864ecde2cbb1ed1b`](https://github.com/bluecadet/launchpad/commit/b7fa754826aa9201da0f02ed864ecde2cbb1ed1b) Thanks [@claytercek](https://github.com/claytercek)! - Include URL query strings for default media download paths

## 1.12.4

### Patch Changes

- [#150](https://github.com/bluecadet/launchpad/pull/150) [`30ddcffdeaa045c7f19b80d454eebdbbe6a978df`](https://github.com/bluecadet/launchpad/commit/30ddcffdeaa045c7f19b80d454eebdbbe6a978df) Thanks [@github-actions](https://github.com/apps/github-actions)! - Abort content downloads on exit

- [`6e214aa9dd6a847a7bc1558a35f1153f976bb1d4`](https://github.com/bluecadet/launchpad/commit/6e214aa9dd6a847a7bc1558a35f1153f976bb1d4) Thanks [@claytercek](https://github.com/claytercek)! - Fix inconsistent deletion of temp/backup directories

## 1.12.3

### Patch Changes

- [`8f3511870ee290678e8b987f75ac9f39929cfba0`](https://github.com/bluecadet/launchpad/commit/8f3511870ee290678e8b987f75ac9f39929cfba0) Thanks [@claytercek](https://github.com/claytercek)! - oops. _Actually_ fix ignoreImageTransformErrors flag

## 1.12.2

### Patch Changes

- [#146](https://github.com/bluecadet/launchpad/pull/146) [`c203bda5812f3573dde4fdc4a000002b4e747325`](https://github.com/bluecadet/launchpad/commit/c203bda5812f3573dde4fdc4a000002b4e747325) Thanks [@claytercek](https://github.com/claytercek)! - Fix json content source media URL scraping

## 1.12.1

### Patch Changes

- [#139](https://github.com/bluecadet/launchpad/pull/139) [`8d894c360d13a11fe662e2378be0ef644602dfe9`](https://github.com/bluecadet/launchpad/commit/8d894c360d13a11fe662e2378be0ef644602dfe9) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Upgrade sharp dependency

## 1.12.0

### Minor Changes

- [#128](https://github.com/bluecadet/launchpad/pull/128) [`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72) Thanks [@claytercek](https://github.com/claytercek)! - Add intellisense support to configs

- [#124](https://github.com/bluecadet/launchpad/pull/124) [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd) Thanks [@claytercek](https://github.com/claytercek)! - support js configs

- [#133](https://github.com/bluecadet/launchpad/pull/133) [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1) Thanks [@claytercek](https://github.com/claytercek)! - Load dotenv files when launching from CLI

### Patch Changes

- [#118](https://github.com/bluecadet/launchpad/pull/118) [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa) Thanks [@claytercek](https://github.com/claytercek)! - Generate d.ts declaration files for intellisense, and fix all type errors.

- Updated dependencies [[`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72), [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd), [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1), [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa)]:
  - @bluecadet/launchpad-utils@1.5.0

## 1.11.0

### Minor Changes

- [#111](https://github.com/bluecadet/launchpad/pull/111) [`6502ded`](https://github.com/bluecadet/launchpad/commit/6502ded3105bd803d38978758d4c3794fc54cd8c) Thanks [@claytercek](https://github.com/claytercek)! - add support for strapi v4

## 1.10.2

### Patch Changes

- [#109](https://github.com/bluecadet/launchpad/pull/109) [`33e6488`](https://github.com/bluecadet/launchpad/commit/33e648884e44ed42be5d600e1a2a9f8c183d1a3c) Thanks [@claytercek](https://github.com/claytercek)! - update `@portabletext/to-html` dependency to fix launchpad content syntax error

## 1.10.1

### Patch Changes

- [`0a62a90`](https://github.com/bluecadet/launchpad/commit/0a62a9083b80eec5587c3ea5c465672c2e041282) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

## 1.10.0

### Minor Changes

- [#98](https://github.com/bluecadet/launchpad/pull/98) [`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added eslint and reformated code

### Patch Changes

- Updated dependencies [[`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee)]:
  - @bluecadet/launchpad-utils@1.4.0

## 1.9.0

### Minor Changes

- [#80](https://github.com/bluecadet/launchpad/pull/80) [`c911be2`](https://github.com/bluecadet/launchpad/commit/c911be2b406d8ff9d6fbc7d17d16af24af26f58a) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Fixed sanity image crop downloads. Added appendCroppedFilenames option

## 1.8.1

### Patch Changes

- [`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

- Updated dependencies [[`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3)]:
  - @bluecadet/launchpad-utils@1.3.1

## 1.8.0

### Minor Changes

- [#68](https://github.com/bluecadet/launchpad/pull/68) [`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

### Patch Changes

- Updated dependencies [[`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3)]:
  - @bluecadet/launchpad-utils@1.3.0

## 1.7.0

### Minor Changes

- [`f3c7916`](https://github.com/bluecadet/launchpad/commit/f3c79169001dd157c7e3bce24da41409a3906d53) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Simplified json url parsing for better efficiency with large files

## 1.6.0

### Minor Changes

- [#62](https://github.com/bluecadet/launchpad/pull/62) [`a4132da`](https://github.com/bluecadet/launchpad/commit/a4132da0187f669ad95251e2f3903229e87d6123) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added caching and blur to image transforms

## 1.5.0

### Minor Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

### Patch Changes

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1

## 1.5.0-next.0

### Minor Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

### Patch Changes

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1-next.0

## 1.4.0

### Minor Changes

- [#47](https://github.com/bluecadet/launchpad/pull/47) [`7f93181`](https://github.com/bluecadet/launchpad/commit/7f9318171c7d44ef812243454608d75810895d14) Thanks [@pingevt](https://github.com/pingevt)! - Updating Sanity source

  Changes config for custom Queries
  Adds an option for saving data in multiple files or in one file

### Patch Changes

- [#47](https://github.com/bluecadet/launchpad/pull/47) [`c9a66e1`](https://github.com/bluecadet/launchpad/commit/c9a66e1416d49c1447d010ab08b3de9c45b4e0a0) Thanks [@pingevt](https://github.com/pingevt)! - Add in better checking to process Sanity Text Blocks

## 1.3.0

### Minor Changes

- [#39](https://github.com/bluecadet/launchpad/pull/39) [`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23) Thanks [@github-actions](https://github.com/apps/github-actions)! - Changeset monorepo restructure

### Patch Changes

- Updated dependencies [[`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23)]:
  - @bluecadet/launchpad-utils@1.2.0

## 1.2.0

### Minor Changes

- [#28](https://github.com/bluecadet/launchpad/pull/28) [`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Start using [🦋 Changesets](https://github.com/changesets/changesets) to manage releases.

### Patch Changes

- Updated dependencies [[`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc)]:
  - @bluecadet/launchpad-utils@1.1.0
