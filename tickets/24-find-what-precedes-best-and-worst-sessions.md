# 24: Find what precedes your best and worst sessions

**Status:** ready-for-agent

**GitHub issue:** [#9](https://github.com/Tslagowski/fitness-insights/issues/9)

**What to build:** Compare the day before your best and worst training sessions (relative to each exercise's own recent history) on intake, carbohydrate, modeled balance, steps, and (when ticket 15 exists) energy check-ins.

**Blocked by:** 07: Explain intake and modeled energy balance; 09: Compare exercise performance and workload. Optional: 15: Record daily energy.

**Acceptance criteria:**

- [ ] Score each session by the mean of its exercises' best-set scores relative to each exercise's preceding three-session median (ticket 09 rules); sessions with too few comparable exercises are excluded and counted.
- [ ] Group sessions into top and bottom thirds (documented) and compare prior-day measures with counts, means, medians, and the difference; prior days must be eligible.
- [ ] Results are labeled as associations in this history with sample sizes; no causal wording, significance claims, or advice. Small samples show Insufficient data.
- [ ] The method version and all session/day evidence are inspectable.
- [ ] Unit tests with synthetic histories where an association is present and absent; UI and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.
