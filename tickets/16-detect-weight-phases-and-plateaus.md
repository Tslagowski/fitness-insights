# 16: Detect weight phases and plateaus

**Status:** ready-for-agent

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
