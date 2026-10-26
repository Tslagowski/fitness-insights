# 25: Add long-range reviews and dated notes

**Status:** in-progress (implemented 2026-10-26; owner review pending)

**GitHub issue:** [#10](https://github.com/Tslagowski/fitness-insights/issues/10)

**What to build:** Generate monthly, quarterly, and yearly written reviews from existing results, and record owner notes on dates (for example a new program or travel) that any analysis can compare before and after.

**Blocked by:** 10: Generate an evidence-backed written overview; 11: Browse immutable report and import history.

**Acceptance criteria:**

- [ ] Owner notes: date (or date range), short text, optional category; private, owner-only, append/edit with history, included in backups and report inputs.
- [ ] Notes appear as markers on time charts and as selectable boundaries: before/after comparisons use equal-length windows and the standard coverage gates.
- [ ] Reviews for a calendar month, quarter, or year reuse ticket 07-09 and 16-24 results with period-appropriate windows, milestones (for example total trend change, largest monthly rates, lifts at their best), and explicit unavailable sections.
- [ ] Reviews are saved as immutable reports (ticket 11) with their inputs and render reproducibly.
- [ ] Database migration, access tests, unit, UI, and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.
