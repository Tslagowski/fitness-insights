# 05: Import workouts with original logging conventions

**Status:** ready-for-agent

**What to build:** Import workout CSV or workbook workout details, then browse the saved sessions and sets exactly as logged.

**Blocked by:** 03: Correct imported history and undo changes.

**Acceptance criteria:**

- [ ] CSV is authoritative on overlapping represented dates, workbook details are fallback, and absent dates are preserved. Original order and legitimate identical sets are retained.
- [ ] Reps remain per side and dumbbell loads per hand. Only logged resistance is used; machine base weight and inferred body weight are never added.
- [ ] Negative assistance, blank loads/reps, timed sets, set type, RIR, and source units remain distinguishable. Missing values do not become zero.
- [ ] Sessions use the documented date/name/duration grouping, with its inability to distinguish identical same-day sessions disclosed. Do not invent durable source IDs.
- [ ] Durations preserve raw values and use a configurable, visibly provisional seconds interpretation; session duration is not summed across sets.
- [ ] Original variants/equipment remain separate. An explicit cosmetic alias can group a rename without altering raw records or silently merging distinct movements.
- [ ] Workout-only import, corrections, reimports, owner access, and undo work through the shared workflow.

**Verification evidence:** Supplied CSV has 3,568 sets over 190 observed workout dates. No conversion may add the separate exported machine-base field. Verify a duration against the source app before release, not by guessing from magnitude.
