# 12: Export and restore a portable backup

**Status:** in-progress (implemented 2026-10-21; owner review on the hosted app pending)

**What to build:** Download a self-contained backup and restore it through an explicit validation/preview workflow, recovering personal history and saved reports on a clean installation.

**Blocked by:** 11: Browse immutable report and import history.

**Acceptance criteria:**

- [ ] Backup includes accumulated records, settings, provenance, review/completeness state, retained versions/reports, and source material necessary to reproduce those versions, with versioned format and integrity checks.
- [ ] No credentials are included. Backup access is restricted to the owner; the downloaded contents are portable to a new owner-configured installation.
- [ ] Restore validates format/integrity and available capacity before previewing replacement. Explicit confirmation precedes the atomic state change.
- [ ] Invalid, interrupted, or stale restore attempts preserve the existing usable state. Identity-bound records are safely rebound to the configured owner, never to arbitrary IDs in an archive.
- [ ] A round-trip preserves counts, row multiplicity, exclusions, formulas/settings references, and saved report output.

## Implementation evidence (2026-10-21)

Design: migration `202610210003_backup_and_restore.sql` adds owner-only `export_backup`, `workspace_counts`, `capacity_status`, `stage_restore_chunk`, `apply_restore`, and `discard_restore`, plus the private `restore_staging` table (no client grants). The backup covers 11 tables (every row with original ids, so revisions, provenance, retained versions, and reports reproduce exactly); none holds a user id, and preferences (the only identity-bound row) travel in the manifest and are saved for the signed-in owner through the normal policy. `apply_restore` validates the format and the staged row count of every table against the manifest and the expected active revision, then deletes and re-inserts everything in one transaction and continues identity counters after the restored ids. The forced RLS check on the table owner was lifted for `exercise_aliases`, `review_decisions`, and `completeness_marks` so the owner-only definer functions can read and restore them; client access to those tables is unchanged (same owner policies). `src/backup/backup.ts` builds and verifies the ZIP (format, checksums, row counts, unexpected files, original exports against their content fingerprints) and chunks rows; `src/backup/capacity.ts` refuses work above 90% of the free 500 MB database or 1 GB storage.

Verified locally:

- 2 database tests: a backup with imports, food, workouts, a cleared day, review decision, completeness mark, alias, and report contains no user id and restores into a clean installation with identical tables, active history, and review state; undo and a new import then continue correctly; a missing chunk, a stale revision, and an unsupported format change nothing; staging is discarded; strangers and anonymous callers are refused; capacity is reported.
- 5 format tests (round trip with multiplicity and exclusions; damaged, missing, unexpected, foreign, newer-format, and inconsistent files rejected; tampered export rejected; chunking; 90% capacity rule).
- 3 UI tests (download from one installation and restore into a fresh one with identical records, review, aliases, reports, and archives; damaged file, full database, interrupted upload, and stale preview leave data unchanged; unreadable service offers no partial backup).
- 1 Chromium test at 390px with mocked transport (real ZIP download, file selection, checksum preview, restore call order, no horizontal overflow); screenshot inspected. A 1px overflow from the native file input in compact density was fixed.
- Full suite: 148 unit/UI/database tests and 11 browser tests pass; typecheck and production build pass (exit codes checked).

Not yet verified: the migration on Supabase, a real download/restore round trip against the hosted service, and request-size limits for large restores (chunks are capped at 500 rows or about 1 MB).
