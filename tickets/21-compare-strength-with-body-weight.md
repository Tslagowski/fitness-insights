# 21: Compare strength with body weight during weight change

**Status:** in-progress (implemented 2026-10-26; owner review pending)

**GitHub issue:** [#6](https://github.com/Tslagowski/fitness-insights/issues/6)

**What to build:** See whether estimated strength on main lifts has been kept, gained, or lost while body weight changed, including strength per pound of trend weight.

**Blocked by:** 08: Compare weight and activity trends; 09: Compare exercise performance and workload.

**Acceptance criteria:**

- [ ] For each positive-load exercise with enough sessions, plot the best-session estimated-strength score (ticket 09 formula and qualifying sets) against date alongside trend weight on separate axes/charts (never a dual axis).
- [ ] Compute relative strength (score per lb of trend weight on the session date, using the nearest eligible trend value within a documented tolerance) and its change between documented windows or phases (ticket 16 when available).
- [ ] Per-hand loads stay as logged; body weight is never added to the load; assisted and timed movements are excluded and listed.
- [ ] Summarize the owner-selected or most-trained lifts in one view; sparse lifts show Insufficient data.
- [ ] Unit, UI, and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.
