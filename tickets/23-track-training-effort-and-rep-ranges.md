# 23: Track training effort and rep ranges

**Status:** ready-for-agent

**GitHub issue:** [#8](https://github.com/Tslagowski/fitness-insights/issues/8)

**What to build:** See the distribution of rep ranges and logged reps in reserve (RIR) per week and per exercise, and how close to failure training has been over time.

**Blocked by:** 09: Compare exercise performance and workload.

**Acceptance criteria:**

- [ ] Bucket working sets by reps (for example 1-5, 6-10, 11-15, 16+) and by logged RIR (0, 1-2, 3-4, 5+, not recorded) per week and per exercise; Failure Set types are reported as logged.
- [ ] Sets without RIR are counted as not recorded, never assumed; timed and assisted sets are handled per ticket 09 semantics.
- [ ] Show trends of the share of sets at RIR 0-2 with coverage; descriptive only.
- [ ] Unit, UI, and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.
