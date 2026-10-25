# 19: Explain over-target days from food detail

**Status:** in-progress (implemented 2026-10-24; owner review pending)

**GitHub issue:** [#4](https://github.com/Tslagowski/fitness-insights/issues/4)

**What to build:** Compare food entries on over-target days with on-target days: which foods, meals, and times of day account for the difference.

**Blocked by:** 04: Import detailed food records without double-counting; 07: Explain intake and modeled energy balance.

**Acceptance criteria:**

- [ ] Classify eligible days with food detail and a target as over target, within a documented band, or under target; counts per class are shown.
- [ ] Rank foods (by logged name, with optional owner aliases) by total calories and by the per-day difference between over-target and on-target days; repeated identical entries are counted as logged.
- [ ] Show calories by hour-of-day bucket (from the logged Time) and the share after a documented evening cutoff, for each day class; entries without a time are reported separately.
- [ ] Workbook-total days without food detail are excluded from food-level analysis and counted as such.
- [ ] No food is labeled good or bad and no swaps are suggested; findings describe contributions only.
- [ ] Unit tests with synthetic food logs including duplicates and missing times; UI and phone tests.

**Constraints:** Follow SPEC.md constraints: pure, versioned, reproducible calculations over eligible data (ticket 06); no AI calls, forecasts, prescriptions, or causal claims; expose counts, dates, method version, and exclusions; insufficient data is stated, never filled in. Charts follow the dataviz rules used by tickets 07-09, and the written overview (ticket 10) may cite the result only through its computed output.

## Implementation evidence (2026-10-24)

Design: migration `202610240001_food_history.sql` adds the owner-only `active_food_entries()` read (security invoker, empty for anyone but the owner, not callable anonymously; added to the anonymous probe). `src/analysis/foods.ts` (`food-patterns-v1`) classes eligible days that have food detail and a calorie target: Over when intake − target is above +100 kcal, Under below −100 kcal, otherwise Within; workbook-total days, detail days without a target, and entries without a calorie value are counted and excluded (never zero). Foods are grouped by logged name exactly as exported (owner aliases for foods are not added; names are shown as logged); repeated identical entries each count. For each food: total kcal, entries, kcal per classed day for each class, and over − within per day; ranked either by that difference or by total. Calories by logged time fall into four buckets (before 11 AM, 11 AM-3:59 PM, 4-7:59 PM, 8 PM or later) per class, with the share at or after the documented 8 PM cutoff and untimed entries reported separately. The panel describes contributions only; no food is labeled good or bad and nothing is suggested.

Verified locally: 2 unit tests (time parsing and band boundaries; classing, exclusions, repeated entries, both rankings, buckets, untimed entries, empty class), 1 database test (owner read matches active food days; stranger gets nothing; anonymous refused), 1 UI test, and a 390px browser test with no horizontal scrolling.
