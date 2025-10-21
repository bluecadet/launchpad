---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-cli": minor
---

Adds 'start' command to CLI for starting launchpad controller in 'persistent' mode. This mode opens an IPC socket, allowing subsequent CLI commands to connect to the running controller instance. The command can be launched with the `-d/--detach` flag to run it in the background. Phase 2 of the multi-interface controller architecture.