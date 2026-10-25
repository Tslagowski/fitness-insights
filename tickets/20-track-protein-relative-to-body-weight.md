# 20: Track protein relative to body weight

**Status:** in-progress (implemented 2026-10-24; owner review pending)

**GitHub issue:** [#5](https://github.com/Tslagowski/fitness-insights/issues/5)

**What to build:** See protein in grams per pound of trend weight over time, how consistently the protein target is met, and the days it is missed.

**Blocked by:** 07: Explain intake and modeled energy balance; 08: Compare weight and activity trends.

**Acceptance criteria:**

- [ ] Daily protein comes from food detail when present, otherwise the workbook total, labeled by source; never summed.
- [ ] Compute g/lb of trend weight on matched eligible days, period mean/median, distribution, and days meeting the protein target with counts.
- [ ] List missed days with their protein and target; show a weekly series with coverage.
- [ ] Ratios are descriptive; no recommended protein amount is asserted beyond the owner's own MacroFactor target.
- [ ] Unit, UI, and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.

## Implementation evidence (2026-10-25)

Design: `src/analysis/protein.ts` (`protein-per-lb-v1`) reads the shared eligible daily series, where daily protein comes from food detail when the day has it, otherwise the workbook total (source counted and labeled, never summed). Grams per lb = protein ÷ MacroFactor's trend weight on the same date when both are eligible. The panel shows mean and median g/lb with matched-day counts, a distribution in 0.1 g/lb bins, the share of days at or above the owner's own MacroFactor protein target (with counts), every missed day with protein, target, difference, g/lb, and source, and a Monday-week series that needs 5 of 7 matched days per week. Scopes: last 4 weeks, 12 weeks (default), all history. No protein amount is recommended beyond the owner's target.

Verified locally: 2 unit tests (ratios, sources, bins, met/missed lists, weekly coverage; missing trend or target leaves the ratio or comparison out), 1 UI test, and a 390px browser test with no horizontal scrolling. Full suite: 186 unit/UI/database tests and 19 browser tests pass; typecheck, build, and the safety check pass.
