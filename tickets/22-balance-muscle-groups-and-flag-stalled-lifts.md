# 22: Show muscle-group balance and stalled lifts

**Status:** in-progress (implemented 2026-10-26; owner review pending)

**GitHub issue:** [#7](https://github.com/Tslagowski/fitness-insights/issues/7)

**What to build:** See weekly working sets per muscle group and push/pull/upper/lower balance from an explicit exercise-to-muscle mapping, and a list of exercises whose progress label has been Stable or Declining for several comparisons in a row.

**Blocked by:** 09: Compare exercise performance and workload.

**Acceptance criteria:**

- [ ] Inspect the workbook's muscle-group sheet; use it only if its accounting is verified, otherwise provide an owner-editable mapping from logged exercise (or alias) to primary and secondary muscles, stored privately and included in backups.
- [ ] Weekly working sets per muscle group count each working set once for the primary muscle (secondary credit only if a documented fractional rule is chosen); unmapped exercises are listed, never guessed.
- [ ] Show push/pull and upper/lower set ratios per week with coverage; no recommended set ranges are asserted.
- [ ] A stalled-lift list shows exercises whose ticket 09 label was Stable or Declining in each of the last N rolling comparisons (N is a setting), with the evidence sessions.
- [ ] Database migration, access tests, unit, UI, and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.

**Implementation note (2026-10-26):** The workbook's "Muscle Groups - Sets" sheet was inspected against "Exercises - Total Sets" for the owner's October 22 export: its daily totals are consistent with fixed per-exercise fractional credits (whole and half sets), but the per-exercise mapping is not exported and several exercises always appear together, so it cannot be recovered or verified per set. The owner-editable mapping (`exercise_muscles`) is used instead; secondary credit is an owner setting (none or half a set).
