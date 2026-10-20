# 09: Compare exercise performance and workload

**Status:** ready-for-agent

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
