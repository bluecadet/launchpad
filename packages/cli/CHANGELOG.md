# @bluecadet/launchpad-cli

## 2.1.1

### Patch Changes

- [#221](https://github.com/bluecadet/launchpad/pull/221) [`8177946a5eb8c5333ef45fd0e4047a75a51de50e`](https://github.com/bluecadet/launchpad/commit/8177946a5eb8c5333ef45fd0e4047a75a51de50e) Thanks [@claytercek](https://github.com/claytercek)! - Smarter/faster config search

- Updated dependencies [[`553bb964a52f6246d59f93ff72631cb963441dd5`](https://github.com/bluecadet/launchpad/commit/553bb964a52f6246d59f93ff72631cb963441dd5)]:
  - @bluecadet/launchpad-utils@2.0.1

## 2.1.0

### Minor Changes

- [#212](https://github.com/bluecadet/launchpad/pull/212) [`1cda9a73ecf4a6d937abbe58bf95469765c67ec2`](https://github.com/bluecadet/launchpad/commit/1cda9a73ecf4a6d937abbe58bf95469765c67ec2) Thanks [@claytercek](https://github.com/claytercek)! - Use unjs' jiti to load config files, enabling support for typescript.

### Patch Changes

- Updated dependencies [[`806fb9a1dcedc0e359bedba7d38a47b73d712b68`](https://github.com/bluecadet/launchpad/commit/806fb9a1dcedc0e359bedba7d38a47b73d712b68)]:
  - @bluecadet/launchpad-content@2.1.0

## 2.0.2

### Patch Changes

- [#210](https://github.com/bluecadet/launchpad/pull/210) [`1138c2b7040bd05c45a4d4e3b242f73d69da1de4`](https://github.com/bluecadet/launchpad/commit/1138c2b7040bd05c45a4d4e3b242f73d69da1de4) Thanks [@claytercek](https://github.com/claytercek)! - fix dotenv cascade order

## 2.0.1

### Patch Changes

- [#206](https://github.com/bluecadet/launchpad/pull/206) [`babd99e1c76ec83c8003815f1c23653a7a122177`](https://github.com/bluecadet/launchpad/commit/babd99e1c76ec83c8003815f1c23653a7a122177) Thanks [@claytercek](https://github.com/claytercek)! - fix optional dependencies. Make them optional _peer_ dependencies instead.

- Updated dependencies [[`babd99e1c76ec83c8003815f1c23653a7a122177`](https://github.com/bluecadet/launchpad/commit/babd99e1c76ec83c8003815f1c23653a7a122177)]:
  - @bluecadet/launchpad-content@2.0.3

## 2.0.0

### Major Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Minor Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- [#191](https://github.com/bluecadet/launchpad/pull/191) [`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1) Thanks [@claytercek](https://github.com/claytercek)! - More verbose error logging, plus better messages on source configs with unions

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`9252b2489f1e7170223c2c2bfaffe2202d32b59a`](https://github.com/bluecadet/launchpad/commit/9252b2489f1e7170223c2c2bfaffe2202d32b59a), [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935), [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989), [`75622fbcf94d84717d6c1107799b5d745828a7a6`](https://github.com/bluecadet/launchpad/commit/75622fbcf94d84717d6c1107799b5d745828a7a6), [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0), [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef), [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741), [`2c2866a77482a18759a4fdacafcb7e6493db6dbb`](https://github.com/bluecadet/launchpad/commit/2c2866a77482a18759a4fdacafcb7e6493db6dbb), [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1)]:
  - @bluecadet/launchpad-utils@2.0.0

## 2.0.0-next.5

### Patch Changes

- [#191](https://github.com/bluecadet/launchpad/pull/191) [`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1) Thanks [@claytercek](https://github.com/claytercek)! - More verbose error logging, plus better messages on source configs with unions

## 2.0.0-next.4

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- Updated dependencies [[`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935)]:
  - @bluecadet/launchpad-utils@2.0.0-next.5

## 2.0.0-next.3

### Patch Changes

- [#178](https://github.com/bluecadet/launchpad/pull/178) [`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- Updated dependencies [[`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758), [`a6f330947de66ba5b95abdf06f66ecfaca67bd0a`](https://github.com/bluecadet/launchpad/commit/a6f330947de66ba5b95abdf06f66ecfaca67bd0a)]:
  - @bluecadet/launchpad-utils@2.0.0-next.4

## 2.0.0-next.2

### Minor Changes

- [#174](https://github.com/bluecadet/launchpad/pull/174) [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

### Patch Changes

- Updated dependencies [[`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e), [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.3

## 2.0.0-next.1

### Patch Changes

- [#170](https://github.com/bluecadet/launchpad/pull/170) [`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.2

## 2.0.0-next.0

### Major Changes

- [#165](https://github.com/bluecadet/launchpad/pull/165) [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Patch Changes

- Updated dependencies [[`3d40d3c3f47afe080f642b3188f5e62a529a891b`](https://github.com/bluecadet/launchpad/commit/3d40d3c3f47afe080f642b3188f5e62a529a891b), [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de)]:
  - @bluecadet/launchpad-utils@2.0.0-next.0
