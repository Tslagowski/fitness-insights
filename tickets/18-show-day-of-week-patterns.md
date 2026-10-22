# 18: Show day-of-week nutrition and weight patterns

**Status:** ready-for-agent

**GitHub issue:** [#3](https://github.com/Tslagowski/fitness-insights/issues/3)

**What to build:** See average intake, target difference, modeled balance, steps, and scale-minus-trend residual for each weekday, and how much each weekday contributes to weekly totals.

**Blocked by:** 07: Explain intake and modeled energy balance.

**Acceptance criteria:**

- [ ] For the selected period (and all history), compute per-weekday counts, mean and median intake, mean target difference, mean modeled balance, steps, and mean scale-minus-trend residual, on eligible days only.
- [ ] Report each weekday's share of the period's total above-target calories and gross surplus, and weekend vs weekday comparisons with counts.
- [ ] Weekdays below a documented minimum count are marked insufficient, not ranked.
- [ ] Reporting calendar is America/Denver with Monday-start weeks; no device-timezone shifts.
- [ ] Findings describe patterns only ("Saturdays averaged +480 kcal vs target over 12 Saturdays") without causes or advice.
- [ ] Unit, UI, and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.
