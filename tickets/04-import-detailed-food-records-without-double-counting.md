# 04: Import detailed food records without double-counting

**Status:** in-progress (implemented 2026-10-20; live migration and owner import pending)

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

## Implementation evidence (2026-10-20)

Design decisions (from the accepted source-authority rules): one import may combine a workbook and a food CSV; food detail is stored per date as an ordered entry array (`food_days`) under the same append-only revisions; the food CSV has precedence over workbook Food Log detail per date, including across imports; a date's entries are replaced as a whole; intake uses the detail sum where detail exists, else the workbook total, never both; reconciliation (max(5 kcal, 1%) on calories) is computed and enforced by the database on dates the import touches.

Verified locally:

- Owner's real files (not committed): the food CSV parses to 5,606 entries on 522 days (May 20, 2025 – Oct 25, 2026) with no findings and all 16 identical repeated rows kept; it covers all 30 workbook dates, so the workbook Food Log (449 entries) is superseded on every overlapping date; 0 of 30 dates exceed the reconciliation tolerance (e.g. Sep 20: 2,496 vs 2,497 kcal); 6 dates (Oct 20–25) are future/planned relative to the export. Run through `commit_sources` in embedded PostgreSQL: ~2.0 MB payload, dry run ~1.2 s, commit ~0.8 s, identical reimport reported all 522 food days and 180 daily records unchanged, history snapshot 141 KB.
- 6 parser tests (RFC 4180 CSV with BOM/quotes/newlines; order, repeats, units, times, missing nutrients; invalid values/dates as findings; in-import CSV-over-workbook precedence; workout/unknown/duplicate files rejected; tolerance).
- 6 database tests: dry run writes nothing; unaccepted disagreement rejected (`FI422`) and accepted one stored; identical reimport unchanged; food-only import leaves daily records and absent dates; workbook Food Log fills gaps but never replaces CSV detail, while a later CSV replaces workbook detail; food clear and multi-step undo restore both record kinds; invalid combinations rejected whole; owner-only access (stranger, anonymous, direct writes).
- 4 UI tests (combined import with intake source labels, planned day, food log entries with repeats; acceptance gate; CSV detail kept on workbook-only reimport; food clear falls back to workbook total and undo restores) plus updated earlier UI tests; 1 Chromium test at 390px with mocked transport (two archive uploads, one commit, food log) with screenshots inspected.
- Full suite: 52 unit/UI/database tests and 5 browser tests; typecheck and both production builds pass.

Not yet verified live: the migration on Supabase, uploading the ~1 MB CSV and committing the ~2 MB payload through the hosted API, and browsing the result on the owner's devices.
