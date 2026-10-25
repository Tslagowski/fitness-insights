# 17: Track expenditure relative to body weight

**Status:** in-progress (implemented 2026-10-24; owner review pending)

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

## Implementation evidence (2026-10-24)

Design: `src/analysis/expenditure.ts` (`expenditure-per-lb-v1`) groups the shared eligible daily series by calendar month or by ticket 16 phase. Over matched days (expenditure and trend weight both eligible) it reports mean expenditure, mean trend weight, and kcal per lb (ratio of the means), with matched-day counts and the 75% coverage gate. Against an owner-chosen reference (default: the first covered group), implied expenditure = reference kcal/lb × the group's mean trend weight; the panel shows the actual change, the change a constant ratio implies, and actual − implied, all labeled as calculations from MacroFactor's estimates rather than a measured metabolic rate or adaptation diagnosis. The steps view is an association only: the least-squares slope of monthly mean expenditure on monthly mean steps (kcal per 1,000 steps) across at least 3 covered months, with the month count. Groups containing a questioned-weigh-in estimate carry †. `CategoryChart.vue` (shared by later tickets) draws actual vs implied on one kcal axis with a legend; the table becomes rows on phones.

Verified locally: 4 unit tests (constant ratio gives zero gap; faster expenditure decline gives a negative gap; uncovered months are not compared and the reference falls to the first covered month; † carries; phase grouping; association needs three months), 1 UI test, and a 390px browser test with no horizontal scrolling.
