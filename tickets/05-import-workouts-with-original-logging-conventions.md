# 05: Import workouts with original logging conventions

**Status:** done (live verified 2026-10-20; duration unit check remains a ticket 14 release gate)

**What to build:** Import workout CSV or workbook workout details, then browse the saved sessions and sets exactly as logged.

**Blocked by:** 03: Correct imported history and undo changes.

**Acceptance criteria:**

- [x] CSV is authoritative on overlapping represented dates, workbook details are fallback, and absent dates are preserved. Original order and legitimate identical sets are retained.
- [x] Reps remain per side and dumbbell loads per hand. Only logged resistance is used; machine base weight and inferred body weight are never added.
- [x] Negative assistance, blank loads/reps, timed sets, set type, RIR, and source units remain distinguishable. Missing values do not become zero.
- [x] Sessions use the documented date/name/duration grouping, with its inability to distinguish identical same-day sessions disclosed. Do not invent durable source IDs.
- [x] Durations preserve raw values and use a configurable, visibly provisional seconds interpretation; session duration is not summed across sets.
- [x] Original variants/equipment remain separate. An explicit cosmetic alias can group a rename without altering raw records or silently merging distinct movements.
- [x] Workout-only import, corrections, reimports, owner access, and undo work through the shared workflow.

**Verification evidence:** Supplied CSV has 3,568 sets over 190 observed workout dates. No conversion may add the separate exported machine-base field. Verify a duration against the source app before release, not by guessing from magnitude.

## Implementation evidence (2026-10-20)

Design: workout sets are stored per date (`workout_days`) as an ordered array of sets with original labels and values, under the same append-only revisions; `commit_sources` (recreated with a `p_workouts` parameter) accepts up to one workbook, one food CSV, and one workout CSV; the workout CSV has precedence over the workbook Workout Log per date, including across imports; clear (`workout_sets`) and undo cover workout days. Sessions are derived for display from (date, workout name, workout duration). Duration interpretation is a preference (`duration_unit`, default seconds) shown as provisional. Display aliases live in `exercise_aliases` (owner-only, cosmetic).

Verified locally:

- Owner's real workout CSV (not committed): 4,084 sets on 219 days (Jan 14 – Oct 19, 2026), no findings, 291 identical repeated sets kept; it supersedes the workbook Workout Log (407 sets) on all 23 overlapping dates; one session per date throughout. Assistance (e.g. Neutral Grip Machine-Assisted Pull-Up at -100 lb), timed Side Plank (Duration 60, no reps), and base weights (e.g. Hack Squat logged 90 lb with base 100 lb, not added) are preserved. The first session's raw duration 2912 reads as 48 min 32 s under the provisional seconds setting; this still needs checking against MacroFactor. Workout payload ~0.7 MB.
- 5 parser tests (as-logged values with repeats/assistance/base weight/timed/blank; CSV-over-workbook precedence; findings; duplicate CSVs; session grouping without summing durations; duration formatting; superset label detection).
- 5 database tests (dry run; exact storage and unchanged reimport; precedence across imports; clear and multi-step undo; invalid payloads; aliases and duration-unit owner-only with stranger/anonymous denial; private workout data).
- 4 UI tests (preview and Training page with sessions and as-logged sets; duration-unit setting; alias only changes display and can be removed; clear and undo of a workout day) plus updated earlier tests; 1 Chromium test at 390px with mocked transport (workout archive upload, Training page, alias), screenshots inspected.
- Full suite: 66 unit/UI/database tests and 6 browser tests; typecheck and both production builds pass.

Not yet verified live: the migration on Supabase, the owner importing the workout CSV on the hosted app, and the one-session duration check against MacroFactor (ticket 14 release gate).

## Live verification (2026-10-20)

- Database migrations run 39449517176 applied `202610200003_workout_detail.sql`; Deploy GitHub Pages run 39449874747 passed (the first Check run for the ticket failed on a test-file type error, fixed in 2e8dd10 and passing in run 39449668241).
- Anonymous calls to `workout_day_sets`, reads of `workout_days`, reads and writes of `exercise_aliases`, `commit_sources`, and workout CSV uploads are refused.
- The owner imported the workout CSV on the hosted app and reported that it worked (owner-reported).
- Still open (release gate, ticket 14): compare one session's duration with MacroFactor's display to confirm the seconds interpretation.
