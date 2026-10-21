# 13: Recover safely from service and quota failures

**Status:** in-progress (implemented 2026-10-21; owner review on the hosted app pending)

**What to build:** Receive actionable recovery guidance when a free service is paused, connectivity fails, or an import cannot fit, then retry safely after the condition is resolved.

**Blocked by:** 12: Export and restore a portable backup.

**Acceptance criteria:**

- [ ] Capacity is checked before activating new data; enforce free-tier boundaries without assuming browser-side estimates alone guarantee a backend write will succeed.
- [ ] A rejected/failed operation leaves active records and retained history usable; the UI does not claim successful synchronization.
- [ ] Retry after a lost response or resumed service recognizes already-committed work and does not duplicate imports or overwrite a newer revision.
- [ ] Retention cleanup touches only unreferenced staging or expired versions; current records, retained snapshots, and required source material survive.
- [ ] Recovery instructions explain manual resume, retry, backup, and explicitly reviewed cleanup. No automatic paid upgrade or below-policy pruning occurs.
- [ ] Backup/restore failure messages remain honest when the service itself is unavailable; do not promise an inaccessible remote backup download.

## Implementation evidence (2026-10-21)

Design: migration `202610210004_capacity_and_recovery.sql` moves the free-tier limits into a private row (`private.capacity_limits`: 500 MB database, 1 GB files, 95% hard stop), extends `capacity_status()` (staging uploads and age), adds `private.enforce_capacity()` as a BEFORE INSERT statement trigger on daily records, food days, workout days, import batches, reports, restore staging, and source files (raises `FI507`; deletes are never blocked), and adds owner-only `discard_stale_restores` (only uploads older than ten minutes). The browser refuses imports, report saves, and restores that would pass 90% (`src/backup/capacity.ts`), shows `CapacityError` messages, recognizes a restore whose response was lost after it committed, and keeps the overview visible when its report cannot be saved. Imports & Settings gains Service and storage (usage meters with level labels and the 90% mark, reviewed cleanup of unfinished uploads, recovery steps); the workspace and history error states explain how to resume a paused project.

Verified locally:

- 2 database tests: usage reported; above the hard stop, imports, report saves, and restore staging are refused while existing data stays unchanged and retention can still free space; after recovery the same request id saves once and replays; only uploads older than ten minutes can be removed, never saved history; strangers and anonymous callers refused.
- 6 recovery UI tests (meters and recovery steps; import stopped before saving at 90%; database hard stop then a single successful retry; reviewed cleanup of unfinished uploads; unreachable service reported honestly in status and backup; report save refused when full while the overview stays) and 1 lost-response restore test.
- 2 Chromium tests at 390px (usage meters and recovery steps; paused service guidance with no changes); screenshot inspected.
- Full suite: 157 unit/UI/database tests and 13 browser tests pass; typecheck and production build pass (exit codes checked).

Not yet verified: the migration on Supabase, and a real paused-project resume.
