# 09: Compare exercise performance and workload

**Status:** in-progress (deployed 2026-10-21: migration run 39532437454, Check 39532437430, Deploy 39532566981; anonymous calls to `active_workout_sets` refused with 42501; owner review pending)

**What to build:** Select an exercise, inspect progression over six comparable sessions, and browse working-set volume, assistance/reps, or duration using the appropriate movement semantics.

**Blocked by:** 05: Import workouts with original logging conventions.

**Acceptance criteria:**

- [ ] For qualifying positive-load Standard/Failure sets at 1-10 reps, use the agreed score, best qualifying set per session, and median of latest three versus preceding three sessions.
- [ ] Above +2.5% is Progressing, below -2.5% Declining, and the inclusive boundary band Stable. Thresholds are configurable; fewer than six qualifying comparable sessions shows Insufficient data.
- [ ] Explain score inputs and actual session date ranges. Display load/reps at comparable loads; no RIR correction, doubled dumbbells/reps, or added machine/body weight.
- [ ] Assistance, bodyweight-only, zero-load, and timed movements do not receive a positive-load strength score. Display their appropriate measures without forcing a misleading mixed-trade-off label.
- [ ] Weekly working-set counts exclude warm-ups without discarding valid blank-load sets. Calendar/date cutoffs exclude future/today from completed comparisons independently of nutrition availability.
- [ ] Any logged-load volume is labeled, limited to supported sets, and never replaced with source muscle-volume accounting that may include base/body weight.
- [ ] Raw input units, grouping limitations, duration assumptions, aliases, and method settings remain traceable.

## Implementation evidence (2026-10-20)

Design: migration `202610210001_exercise_analysis.sql` adds `active_workout_sets()` (owner-only, every active workout day in one read) and the bounded `preferences.strength_band_percent` setting (default 2.5, 0.5-20). `src/analysis/exercise.ts` (method `exercise-v1`) groups sets into sessions by (date, workout name, workout duration, display name), using ticket 06 workout eligibility so today, future, and unconfirmed days never enter comparisons. Scores, labels, reps at comparable loads, per-movement measures, logged-load volume, and Monday-start weekly working sets are pure functions; the Training page shows the label with the six compared sessions, reps at shared loads, a score chart with group medians (palette-validated blue/orange plus gray context), and weekly sets. The label band boundary is compared at fixed precision so exactly ±band is Stable. The migration workflow now runs every database test before applying migrations.

Verified locally:

- 11 rule tests: best qualifying set and medians (+10% Progressing); inclusive Stable band at exactly 2.5%, configurable band, Declining; fewer than six sessions is Insufficient data with history kept; base weight never added and RIR ignored; qualifying-set rules; reps at shared loads; assisted/bodyweight/timed measures without scores; mixed load types unlabeled; explicit aliases with logged names listed; weekly working sets excluding warm-ups but keeping blank-load sets, with today/future/unconfirmed days left out; separate same-day sessions by workout name and duration.
- 1 database test: `active_workout_sets()` returns exactly the active sets, oldest first, empty for a stranger, denied to anonymous; the band is bounded.
- 4 UI tests (label and evidence excluding today's session; assisted movement not scored; band changes the label and saves; failed load with retry) and 1 Chromium test at 390px (label, timed movement, no horizontal overflow); screenshot inspected.
- Full suite: 124 unit/UI/database tests and 9 browser tests pass; typecheck and production build pass (exit codes checked).

Not yet verified: owner review with real workouts. The migration was applied by run 39532437454.
