---
"@bluecadet/launchpad-content": minor
---

Add the keep-N retention sweep for versioned output, run at the end of each successful versioned fetch. The retention set is the `keep` newest version dirs by name (default 3), union the manifest's active version, union any version named by a fresh ack lease (`<downloadPath>/acks/<consumerId>.json`, freshness by mtime vs `ackTimeout`, default 30m); everything else under `versions/` is deleted. Deletion is best-effort and idempotent -- a locked dir is left in place and retried on the next sweep. Sweep results (retained/pending-delete counts, per-consumer ack freshness) are tracked on the content plugin's state.
