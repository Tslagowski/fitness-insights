# 20: Track protein relative to body weight

**Status:** ready-for-agent

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
