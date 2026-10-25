# 16: Detect weight phases and plateaus

**Status:** in-progress (implemented 2026-10-24; owner review pending)

**GitHub issue:** [#1](https://github.com/Tslagowski/fitness-insights/issues/1)

**What to build:** See your history split into losing, slowing, maintaining, and gaining phases from MacroFactor's trend-weight rate, with each phase's intake, deficit, steps, protein, and training summarized side by side.

**Blocked by:** 08: Compare weight and activity trends; 09: Compare exercise performance and workload.

**Acceptance criteria:**

- [ ] Segment eligible trend-weight history into contiguous phases using a documented, deterministic rule on the rolling weekly rate (for example a 14-day least-squares rate with labeled bands and a minimum phase length); thresholds are versioned settings.
- [ ] A plateau is a phase whose rate stays inside the maintenance band for at least the minimum length; it is described only as a change in rate, never as a metabolic diagnosis.
- [ ] For each phase show dates, length, start/end trend weight, rate, and the mean intake, modeled balance, target difference, steps, protein, weekly working sets, and coverage for each measure (each with its own coverage gate).
- [ ] A phase timeline chart (trend line with shaded phases) and a phase comparison table/cards; selecting a phase opens its dates and evidence.
- [ ] Gaps in trend data split or shorten phases rather than being interpolated; the rule and its parameters are shown.
- [ ] Unit tests cover synthetic loss, plateau, regain, gaps, and boundary rates; UI and 390px browser tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.

## Implementation evidence (2026-10-24)

Design: a new Insights page (`#insights`) hosts tickets 16-25. `src/analysis/daily.ts` builds one eligible-only row per calendar date (intake and protein from food detail when present, otherwise the workbook total; never summed; nothing interpolated). `src/analysis/phases.ts` (`weight-phases-v1`): each date with a trend value gets 7 × the least-squares slope of the trend values in the trailing 14 calendar days when at least 10 are present; bands are Losing ≤ −0.5 lb/week < Slowing ≤ −0.15 < Maintaining < +0.15 ≤ Gaining (inclusive at the boundaries, compared at 6 decimals); consecutive dates with the same band form runs, a missing rate ends a run, a run shorter than 14 days between two runs of the same band takes their band, and remaining short runs are listed as too short to label. A Maintaining phase is labeled a plateau and described only as the trend line's rate. Each phase shows dates, length, start/end trend, its own rate, and mean intake, modeled balance, target difference, steps, protein, and working sets per week, each behind the standard 75% coverage gate. `TimelineChart.vue` draws the trend line with shaded phases (diverging blue-gray-red bands plus a solid strip), one axis, a legend, hover readout, note markers (ticket 25), and keyboard phase selection; the phase table becomes rows on phones.

Verified locally: 5 unit tests (loss/plateau/regain with exact phase dates and summaries; a gap splits a phase and restarts the window; inclusive band boundaries; short-run absorption; eligibility and coverage through `buildDailySeries`), 1 UI test, and a 390px browser test with no horizontal scrolling. Full suite: 170 unit/UI/database tests and 15 browser tests pass; typecheck passes.
