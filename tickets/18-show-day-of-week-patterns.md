# 18: Show day-of-week nutrition and weight patterns

**Status:** in-progress (implemented 2026-10-24; owner review pending)

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

## Implementation evidence (2026-10-24)

Design: `src/analysis/weekdays.ts` (`weekday-patterns-v1`) groups the shared eligible daily series by the weekday of each America/Denver reporting date (Monday = 0, computed from the date itself, so no device time zone can shift it). Per weekday: days in scope, intake count/mean/median, mean target difference, mean modeled balance, mean steps, and mean scale − trend residual, each needing 3 eligible days (documented minimum) before it is shown or ranked; shares of the scope's above-target calories Σ max(0, intake − target) and gross surplus Σ max(0, balance); weekend (Sat-Sun) vs weekday (Mon-Fri) means with counts. Findings are pattern sentences with counts (for example "Saturdays averaged +400 kcal vs target over 12 Saturdays"), never causes or advice. Scopes: last 4 weeks, last 12 weeks (default), all history. The chart shows mean vs target by weekday; the table becomes rows on phones.

Verified locally: 3 unit tests (weekday indices across a DST change; means, residuals, shares, exact finding text, no causal wording; insufficient weekdays never ranked), 1 UI test, and a 390px browser test with no horizontal scrolling. Full suite: 179 unit/UI/database tests and 17 browser tests pass; typecheck and the safety check pass.
