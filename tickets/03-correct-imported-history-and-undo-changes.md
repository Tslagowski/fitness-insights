# 03: Correct imported history and undo changes

**Status:** done (live verified 2026-10-20)

**What to build:** Upload an overlapping workbook and review additions/corrections, intentionally clear a day's records, or undo the latest confirmed import without losing unrelated history.

**Blocked by:** 02: Import workbook daily history.

**Acceptance criteria:**

- [x] Preview distinguishes added, changed, and unchanged data; confirmed replacement affects only explicitly represented dates within the relevant domain.
- [x] Absent dates preserve saved records. Explicit day clearing has its own preview and affects only the selected domain.
- [x] Reimporting unchanged data does not add duplicates or create an artificial changing import version.
- [x] Every changing import preserves the prior revision; Undo last import restores the previous active records and relevant review state atomically.
- [x] A preview based on an older revision cannot overwrite a change from another device. The user is prompted to refresh the preview.
- [x] Retried/failed commits preserve history; the import history explains the result. The revision contract supports additional source domains without a separate correction mechanism.

## Implementation evidence (2026-10-20)

Design: migration `202610200001_corrections_and_undo.sql` turns `import_batches` into a change log (`workbook`, `clear`, `undo`) with removed counts, cleared date/domain, and `undoes_batch_id`. `clear_day` retires one active record in a new revision. `undo_last_change` targets the newest changed import/clear not yet undone and restores the active set as of that change's base revision (active at R = introduced <= R and not retired by R), retiring differing current rows and inserting copies of the earlier rows in a new revision; `p_dry_run` reports counts without writing. Both serialize on the workspace row, replay a known request id, and reject a stale expected revision (`FI409`). `active_history` now returns change kinds, undone flags, and the undo target.

Verified locally:

- 4 database tests on the migrations in embedded PostgreSQL (non-bypass table owner): clear removes only the chosen domain/date; dry-run undo writes nothing; undo restores exact records, is replay-safe, and repeats back through clear, a correcting import, and the first import to an empty history; earlier versions remain reconstructable; a later import becomes the next undo target; stale, missing, and invalid requests change nothing; stranger, email-provider owner, and anonymous callers are denied.
- 5 UI tests: overlapping preview with before/after correction and kept-dates count; clear then undo with exact restoration and change-log wording; undo back to empty; another device's change blocks a pending undo or clear without overwriting; failed clear retried with the same request id clears once.
- 1 Chromium test at 390px with mocked transport: clear confirmation, `clear_day` and `undo_last_change` (dry run, then commit) requests with the expected revision, change log text, no horizontal overflow; screenshots inspected. It caught and fixed label markup that made the date selector's accessible name include every option.
- Full suite: 36 unit/UI/database tests and 5 browser tests pass; typecheck and both production builds pass.

Not yet verified live: the migration run on Supabase, and the owner clearing a day and undoing on the hosted app.

## Live verification (2026-10-20)

- Database migrations workflow run 39438022374 applied `202610200001_corrections_and_undo.sql`; Check run 39438021877 passed; Deploy GitHub Pages run 39438183344 passed.
- Anonymous calls to `clear_day` and `undo_last_change` (including the dry run) return `42501`.
- The owner reviewed the deployed Imports & Settings page and ran Undo on the live site successfully (owner-reported). Live clearing of a day was not separately reported; it is covered by the database, UI, and browser tests above.
