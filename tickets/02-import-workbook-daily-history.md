# 02: Import workbook daily history

**Status:** done (live verified 2026-10-19)

**What to build:** From Imports & Settings, select a workbook, preview daily date coverage and values, confirm it, then browse the imported history from another device. This slice handles daily measurements, targets, expenditure, nutrition totals, and steps; detailed food/workout rows are added later.

**Blocked by:** 01: Sign in and retain a private preference.

**Acceptance criteria:**

- [x] Detect the workbook schema by sheet/header structure rather than filename. Unsupported or malformed files produce an actionable error without changing saved history.
- [x] Preserve original dates, units, missing values, raw source archive, and domain provenance. Missing numeric data is not zero.
- [x] Preview shows represented dates and records; confirming creates an atomic data revision with a private source archive. Partial staging is never visible as committed history.
- [x] Repeat submission of the identical effective import is harmless; a timeout followed by retry cannot create a duplicate committed batch.
- [x] Saved daily records and per-domain freshness are available after refresh and on another device. Nutrition totals are provisional workbook-sourced totals until detailed imports exist.
- [x] Owner access applies to raw archives and records. Unsupported or failed imports preserve the previous revision and report an honest failure.

**Verification evidence:** The current workbook has 30 daily rows. A full-history workbook must later be inspected; its absence does not block this sample-based slice. Do not present the 30-day sample as full-history daily coverage.

## Implementation evidence (2026-10-19)

Design: the workbook is parsed in the browser by a small `.xlsx` reader (`fflate` + DOMParser) that converts date cells with integer day arithmetic, so no time zone can shift a date. The daily sheet is detected by its required columns; each row becomes six domain records (`scale_weight`, `trend_weight`, `expenditure`, `nutrition_totals`, `targets`, `steps`) whose fields keep the original column labels (units included) and `null` for blanks. Records are versioned by `introduced_revision_id`/`retired_revision_id`; `workspace_state` holds the active revision. `commit_import` (security definer, owner check first) serializes on the workspace row, replays a known request id, rejects a stale expected revision (`FI409`), verifies the archived object exists in Storage, validates the payload, and applies added/changed records atomically. `active_history` returns one consistent snapshot under row-level security.

Verified locally:

- Parser against the owner's real 30-day export (Sep 20 – Oct 19, 2026; not committed): 30 dates, 180 records, 55 nutrition columns, no findings, no ignored columns; Food Log and Workout Log classified for tickets 04/05; muscle-group and program sheets archived.
- 8 parser tests (header-based detection, non-workbook and missing-column errors, duplicate-date rejection, missing vs zero, invalid values kept unavailable with findings, text/invalid dates, both Excel date systems).
- 6 database tests on the real migration in embedded PostgreSQL, with tables owned by a role without superuser/BYPASSRLS as on Supabase: first commit, idempotent retry, unchanged reimport (no revision), correction of only represented date/domain with absent dates preserved and the prior row retired, stale preview rejection, whole-payload rejection, stranger/anon/email-provider denial, and no direct writes even for the owner.
- 5 UI tests (preview then confirm then second device sees history; unsupported file; failed commit with same-request retry; stale preview refreshed without overwrite; identical reimport reports no changes).
- 1 Chromium browser test at 390px with mocked Supabase transport: archive upload path, single commit with null expected revision, no horizontal overflow; screenshots inspected.
- Full suite: 26 unit/UI/database tests and 4 browser tests pass; typecheck and default plus subpath production builds pass.

Migrations are applied by the Database migrations workflow (Supabase CLI `db push`); the hand-applied baseline migration was made idempotent so the first automated run can re-apply it safely (covered by a re-run test).

Not yet verified live: the first workflow run against the Supabase project, Storage bucket policies, an actual import on the hosted app, and viewing it from a second device. Storage policies are not exercised by the embedded database tests.

## Live verification (2026-10-19)

- Database migrations workflow run 39363832300 applied `202609150001` (idempotent re-apply), `202610190001`, and `202610190002` via `supabase db push`; the remote migration history lists all three.
- Anonymous direct requests to `daily_records`, `import_batches`, `workspace_state`, `active_history`, and `commit_import` return `42501`; the `source-archives` bucket is not public, anonymous listing returns nothing, and anonymous upload is rejected by row-level security.
- Deploy GitHub Pages run 39363927122 passed.
- The owner imported the real 30-day workbook in the hosted/dev app and confirmed it; the imported history was visible afterward. Owner-reported.

Not exercised live: a corrected overlapping reimport, a retried commit after a lost response, and a stale cross-device preview (covered by database and UI tests; correction and undo flows are ticket 03).
