# 13: Recover safely from service and quota failures

**Status:** ready-for-agent

**What to build:** Receive actionable recovery guidance when a free service is paused, connectivity fails, or an import cannot fit, then retry safely after the condition is resolved.

**Blocked by:** 12: Export and restore a portable backup.

**Acceptance criteria:**

- [ ] Capacity is checked before activating new data; enforce free-tier boundaries without assuming browser-side estimates alone guarantee a backend write will succeed.
- [ ] A rejected/failed operation leaves active records and retained history usable; the UI does not claim successful synchronization.
- [ ] Retry after a lost response or resumed service recognizes already-committed work and does not duplicate imports or overwrite a newer revision.
- [ ] Retention cleanup touches only unreferenced staging or expired versions; current records, retained snapshots, and required source material survive.
- [ ] Recovery instructions explain manual resume, retry, backup, and explicitly reviewed cleanup. No automatic paid upgrade or below-policy pruning occurs.
- [ ] Backup/restore failure messages remain honest when the service itself is unavailable; do not promise an inaccessible remote backup download.
