---
"@bluecadet/launchpad-cli": patch
---

Fix `launchpad start` exiting when a `start` workflow step fails. Step failures are now logged and the controller keeps running, so healthy plugins stay up when e.g. a content fetch fails. Runtime command errors also no longer dump the command's usage/help text before the error message.
