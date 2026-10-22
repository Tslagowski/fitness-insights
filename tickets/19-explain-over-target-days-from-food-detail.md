# 19: Explain over-target days from food detail

**Status:** ready-for-agent

**GitHub issue:** [#4](https://github.com/Tslagowski/fitness-insights/issues/4)

**What to build:** Compare food entries on over-target days with on-target days: which foods, meals, and times of day account for the difference.

**Blocked by:** 04: Import detailed food records without double-counting; 07: Explain intake and modeled energy balance.

**Acceptance criteria:**

- [ ] Classify eligible days with food detail and a target as over target, within a documented band, or under target; counts per class are shown.
- [ ] Rank foods (by logged name, with optional owner aliases) by total calories and by the per-day difference between over-target and on-target days; repeated identical entries are counted as logged.
- [ ] Show calories by hour-of-day bucket (from the logged Time) and the share after a documented evening cutoff, for each day class; entries without a time are reported separately.
- [ ] Workbook-total days without food detail are excluded from food-level analysis and counted as such.
- [ ] No food is labeled good or bad and no swaps are suggested; findings describe contributions only.
- [ ] Unit tests with synthetic food logs including duplicates and missing times; UI and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.
