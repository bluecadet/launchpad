---
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-cli": minor
---

refactor: extract content fetch pipeline into stages

Extract the fetch pipeline from LaunchpadContent into composable stage
functions (setupHooks, backup, clearOldData, fetchSources, etc.) for
better testability and modularity. Simplify state management with inline
phase tracking. Add comprehensive tests for fetch context and stages.

This is a breaking change as it modifies the API of LaunchpadContent by 
adding the loadSources() method, as well as changing the fetch() and 
clear() methods to accept just the source IDs instead of full source 
objects.