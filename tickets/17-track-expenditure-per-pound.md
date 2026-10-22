# 17: Track expenditure relative to body weight

**Status:** ready-for-agent

**GitHub issue:** [#2](https://github.com/Tslagowski/fitness-insights/issues/2)

**What to build:** See how MacroFactor's expenditure estimate changes relative to trend weight over time, to tell whether expenditure has fallen more or less than the weight change alone accounts for.

**Blocked by:** 08: Compare weight and activity trends.

**Acceptance criteria:**

- [ ] Compute monthly (and per-phase when ticket 16 exists) mean expenditure, mean trend weight, and expenditure per pound of trend weight from matched eligible days, each with counts.
- [ ] Show the change in expenditure alongside the change that a constant kcal-per-lb ratio from a chosen reference period would imply; label both as calculations from MacroFactor estimates, not a measured metabolic rate or adaptation diagnosis.
- [ ] Optionally show the same per-step-adjusted view (expenditure vs steps) as an association with its coverage.
- [ ] Questioned-weigh-in warnings (†) carry through to affected months.
- [ ] Unit tests with synthetic histories; UI and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.
