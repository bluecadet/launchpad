---
"@bluecadet/launchpad-content": minor
---

Wire versioned output into the fetch pipeline: under `versioning`, `finalizingStage` moves the staged downloads root whole into `versions/<versionId>/` and atomically swaps `manifest.json` as the sole commit point, emitting `content:version:promoted` right after. `backupStage` and the restore half of `errorRecoveryStage` are silent no-ops under versioning (retained versions are the backup); a failed promotion instead best-effort deletes the orphaned version dir. Opt-in via `versioning` config; no change to default output behavior.
