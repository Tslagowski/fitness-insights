# 04: Import detailed food records without double-counting

**Status:** ready-for-agent

**What to build:** Select a food CSV, workbook food details, or both and browse the saved food entries and their daily totals. Inspect disagreements with daily workbook nutrition in the same preview.

**Blocked by:** 03: Correct imported history and undo changes.

**Acceptance criteria:**

- [ ] Parse BOM-prefixed CSV, quoted fields, local food times, units, and missing nutrients. Source row multiplicity is preserved, including legitimately identical foods.
- [ ] Food CSV wins on overlapping represented dates when provided; workbook food detail is fallback. Daily totals without detail remain available with workbook source attribution.
- [ ] Workbook totals and detailed sums are never added together. Reconciliation flags differences exceeding the specification's tolerance and requires acceptance of the documented source winner.
- [ ] Food-only imports do not replace weight, expenditure, targets, steps, or workout data. Missing dates do not erase food history.
- [ ] Preview, correction, repeat-import handling, and undo work for granular records through the existing import workflow.
- [ ] Future entries remain identifiable by source date/import metadata, never advertised as confirmed consumed food. The eligibility workflow is completed in 06.

**Verification evidence:** Supplied food CSV has 5,064 rows, including 56 future-dated entries relative to its September 13 export. Keep private input validation separate from public synthetic fixtures.
