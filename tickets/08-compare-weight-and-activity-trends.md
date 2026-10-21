# 08: Compare weight and activity trends

**Status:** in-progress (deployed 2026-10-21 with ticket 09: Deploy 39532566981; owner review pending)

**What to build:** Explore scale weight, source trend weight, and steps across periods, seeing how coverage and exclusions affect the displayed changes.

**Blocked by:** 06: Review suspicious values and incomplete days.

**Acceptance criteria:**

- [ ] Show scale points and source trend values separately, with gaps rather than silently filled missing measurements.
- [ ] Weekly trend rate follows the documented elapsed-calendar-day slope formula and coverage gate. Source trend is not reconstructed from the owner's scale data.
- [ ] Steps averages use observed eligible values and show their own coverage; lack of nutrition or workout data does not erase valid standalone series.
- [ ] Seven-day, 28-day, and custom dates follow the agreed calendar and standard cutoff conventions; no chart shifts source dates because the viewing device uses another timezone.
- [ ] Individual points and comparison results link to their source dates, units, exclusions, and method. Suspect source estimates retain warnings after a scale exclusion.
- [ ] A corrected import or review decision updates active results while preserving historical revisions for later report snapshots.

## Implementation evidence (2026-10-20)

Design: `src/analysis/trends.ts` (method `weight-activity-v1`) builds one row per calendar date from saved records and the ticket 06 eligibility report; tiles, both charts, the selected-day panel, and the date table read those rows. Periods, coverage gates, and the least-squares slope live in `src/analysis/periods.ts`, shared with ticket 07, and one period picker scopes the whole Nutrition & Weight page. Dates are calendar strings handled with integer day arithmetic, so the viewing device's timezone cannot shift them. The period ends at the latest confirmed intake day, or, with no intake, the latest confirmed day with weight, trend, or steps. Chart colors (blue scale points, orange trend line, green steps) passed the dataviz palette validator on the card surface. No database change: corrected imports and review decisions flow through the active history and eligibility, while revisions stay preserved for ticket 11 reports.

Verified locally:

- 5 rule tests: weekly rate equals 7 × the elapsed-calendar-day slope with missing days skipped; scale and trend separate with an excluded 297.8 lb weigh-in left out while the trend keeps its warning dates; steps report with their own coverage when nutrition and weight are absent; insufficient coverage withholds comparisons without filling gaps; a corrected value updates the active result.
- 3 UI tests (rate, mean, and steps comparisons; hollow excluded point with the † warning; steps-only history and the selected-day panel) and the phone browser test extended at 390px (shared period, rate tile, gaps in scale points, no horizontal overflow); screenshot inspected.
- Full suite: 108 unit/UI/database tests and 8 browser tests pass; typecheck and production build pass (exit codes checked).

Not yet verified: owner review on the hosted app with real history.
