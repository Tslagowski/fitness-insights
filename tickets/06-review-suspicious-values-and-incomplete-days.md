# 06: Review suspicious values and incomplete days

**Status:** ready-for-agent

**What to build:** Open a review queue, keep or exclude a suspicious value, mark a nutrition day incomplete, and inspect which dates/fields are eligible for analysis.

**Blocked by:** 04: Import detailed food records without double-counting.

**Acceptance criteria:**

- [ ] Flag weight more than 10% from the median of at least three prior accepted weigh-ins within seven calendar days; without the baseline, do not fabricate a relative flag.
- [ ] Pending values remain in raw records and are excluded only from dependent calculations. Keeping/excluding a scale value leaves valid food and activity data usable.
- [ ] The confirmed 297.8 lb error is flagged when its preceding baseline is available. Source trend/expenditure affected by an error remains labeled; dropping a scale point does not pretend to repair those estimates.
- [ ] Today is In progress; future dates are excluded; owner-marked incomplete nutrition days are excluded from affected metrics. Unusually high calories are not automatically removed and low intake alone does not establish incompleteness.
- [ ] Review decisions persist across devices and apply to specific source values; replacing a changed value triggers reevaluation. Completeness overrides persist until explicitly changed.
- [ ] Display the imported cutoff/freshness and exclusion reasons. A formerly future prelog does not silently extend confirmed import coverage merely because time passed.
- [ ] Undo and revision history preserve the applicable review/completeness state.
