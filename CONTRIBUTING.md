# Contributing to Launchpad

## Generating Changelogs

If you are contributing a user-facing or noteworthy change to Launchpad that should be added to the changelog, you should include a changeset with your PR.

To add a changeset, run this script locally:

```
npm run changeset
```

Follow the prompts to select which package(s) are affected by your change, and whether the change is a major, minor or patch change. This will create a file in the `.changesets` directory of the repo. This change should be committed and included with your PR.

Considerations:

- A changeset is required to trigger the versioning/publishing workflow.
- Non-packages, like examples and tests, do not need changesets.
- You can use markdown in your changeset to include code examples, headings, and more. However, please use plain text for the first line of your changeset. The formatting of the GitHub release notes does not support headings as the first line of the changeset.

## Releases

The [Changesets GitHub action](https://github.com/changesets/action#with-publishing) will create and update a PR that applies changesets and publishes new versions of changed packages to npm.

To release a new version of Launchpad, find the `Version Packages` PR, read it over, and merge it.

The `main` branch is kept up to date with the latest releases.

## Testing Launchpad

If you want to test Launchpad as a local dependency and frequently make changes, then the best way to do that is to clone launchpad and link `npm @bluecadet/launchpad` in your local project.

For example:

```bat
git clone git@github.com:bluecadet/launchpad.git
cd launchpad
npm i
cd packages/launchpad
npm link

cd ../../my-test-project
@REM If needed: npm init
npm link @bluecadet/launchpad
@REM  If needed for your project: npm i @bluecadet/launchpad
```
