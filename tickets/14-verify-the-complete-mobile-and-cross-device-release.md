# 14: Verify the complete mobile and cross-device release

**Status:** in-progress (automated verification done 2026-10-21; owner verification on the hosted app and two external release gates pending)

**What to build:** Complete the owner's weekly workflow on the hosted app: import on a phone, review on another device, correct data, regenerate findings, and recover from a failed update.

**Blocked by:** 13: Recover safely from service and quota failures.

**Acceptance criteria:**

- [ ] Demonstrate the four views, mobile upload/review, signed-in cross-device refresh, corrected reimport, undo, historical reports, and backup/restore on the assembled application.
- [ ] Verify a corrected full-history workbook without inventing unavailable historical values; confirm the known weight error is corrected or explicitly excluded.
- [ ] Verify one workout duration against MacroFactor's displayed value, retaining its configurable source-unit interpretation and raw records.
- [ ] Direct unauthorized record/archive requests fail; the public repository/build contains no private sources or privileged credentials.
- [ ] Exercise the sparse-data, high-calorie, negative-assistance, per-hand/per-side, missing-date, repeated-row, stale-write, and service-failure scenarios through relevant tests and focused end-to-end checks.
- [ ] Publish operating instructions for setup, normal weekly imports, known session grouping limitations, free-tier recovery, retention, and portability. Record actual verification outcomes and unresolved release blockers.

**External release gates:** Corrected full-history workbook and one source-app duration comparison. These do not prevent earlier tickets from using the supplied private samples and synthetic fixtures; they do prevent claiming full-source verification.

## Verification record (2026-10-21)

### Done automatically

- **Operating instructions:** [docs/operations.md](../docs/operations.md) covers setup, the weekly import routine, corrections, known session-grouping and duration limitations, free-tier recovery, retention, and portability.
- **Public repository and build:** `scripts/check-public-safety.mjs` (run by Check after every build and by Deploy before publishing) fails on any tracked spreadsheet, CSV, ZIP, or environment file, and on Supabase secret keys, JWTs, personal access tokens, private keys, or GitHub tokens in tracked files or the built site. It passed on 138 tracked files and the build, and was shown to catch a planted secret.
- **Direct unauthorized requests:** `scripts/probe-anonymous-access.mjs` (run by Deploy after publishing) confirmed on the hosted project that all 14 tables, 17 functions, and archive listing/upload refuse anonymous requests. Owner-versus-stranger rules are covered by the database tests (access, import, corrections, food, workout, review, report, backup, capacity).
- **Weekly workflow:** `tests/release-workflow.test.ts` imports on a "phone" through the UI, reads on a second "device" after refresh, saves reports, applies a corrected re-import (1 corrected record), undoes it, downloads a backup, and restores it into a fresh installation with identical records, reports, and change history.
- **Scenario coverage** (relevant tests):
  - Sparse data: `report.test.ts` (explicit unavailable sections), `intake-ui.test.ts` (Insufficient coverage), `exercise.test.ts` (Insufficient data).
  - High calories: `intake.test.ts` (4,800 kcal day kept), `report.test.ts` (highest days named and kept).
  - Negative assistance: `exercise.test.ts`, `exercise-ui.test.ts` (assisted movements not scored; least assistance shown).
  - Per-hand / per-side: `exercise.test.ts` (load and reps as logged, base weight never added), `workout.test.ts`.
  - Missing dates: `trends.test.ts` (gaps not filled), `import-database.test.ts` (absent dates untouched).
  - Repeated rows: `food-database.test.ts`, `workout-database.test.ts`, `backup.test.ts` (multiplicity kept).
  - Stale writes: `import-ui.test.ts`, `corrections-ui.test.ts`, `report-database.test.ts`, `backup-ui.test.ts`, `backup-database.test.ts`.
  - Service failure: `recovery-ui.test.ts`, `backup-ui.test.ts`, `report-ui.test.ts`, `capacity-database.test.ts`, `tests/browser/recovery.spec.ts`.
- **Full suite:** 158 unit/UI/database tests and 13 browser tests (390px phone viewport, mocked transport) pass; typecheck, production build, and the safety check pass. Every migration through `202610210004` was applied by the Database migrations workflow.

### Owner verification on the hosted app (pending)

The four views, mobile upload and review, signed-in cross-device refresh, corrected re-import, undo, historical reports, backup/restore, and a real paused-service recovery need the owner on the live site; mocked browser tests do not prove live OAuth or synchronization.

### External release gates (open)

1. A corrected full-history workbook, checked without inventing missing history; the known 297.8 lb weigh-in must be corrected or explicitly excluded.
2. One workout's duration compared with MacroFactor's display (for example 2912 should show 48 min 32 s if the values are seconds); the unit stays configurable and raw values are kept.
