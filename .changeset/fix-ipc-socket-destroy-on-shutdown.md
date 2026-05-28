---
"@bluecadet/launchpad-controller": patch
---

Fix libuv assertion error on Windows when closing IPC transport during shutdown by using `socket.destroy()` instead of `socket.end()`.
