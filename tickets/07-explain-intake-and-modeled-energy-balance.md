# 07: Explain intake and modeled energy balance

**Status:** in-progress (implemented 2026-10-20; owner review on the hosted app pending)

**What to build:** Use Nutrition & Weight to compare intake distributions, targets, and estimated expenditure over seven-day, 28-day, or custom periods, opening the actual dates behind each metric.

**Blocked by:** 06: Review suspicious values and incomplete days.

**Acceptance criteria:**

- [ ] Calculate mean, median, population standard deviation, and target differences from eligible dates; show counts and source attribution.
- [ ] Compute daily modeled balance on matched intake/expenditure dates, gross surplus, gross deficit, net balance, surplus frequency, and surplus-to-deficit ratio as defined in the specification.
- [ ] A zero gross deficit yields an unavailable ratio, not division by zero. Ratios over 100% are permitted. No modeled balance is asserted to be measured fat change.
- [ ] Default windows end at the latest imported past day with intake; dates/freshness are explicit. Require 21/28 or 5/7 eligible matched days in each period; apply documented custom-window rules.
- [ ] Below coverage thresholds show available records/charts and Insufficient coverage instead of misleading headline comparisons.
- [ ] High-intake observations remain in distributions. Chart selections expose the underlying daily values, exclusions, and formulas; charts and metrics use identical results.

## Implementation evidence (2026-10-20)

Design: a pure module (`src/analysis/intake.ts`, method `intake-balance-v1`) builds one row per date in the period from saved history and the ticket 06 eligibility report; the metrics, both charts, the selected-day panel, and the "Dates behind these numbers" table all read those rows. No database change. The 7- and 28-day periods end at the latest past day with imported intake confirmed by a later import; custom periods (up to 366 days, ending before today) need ceil(0.75 x length) days. Each period is compared with the same length immediately before it. Intake metrics are gated on counted intake days and balance metrics on matched intake/expenditure days; comparisons need both periods to pass. Chart colors were checked with the dataviz palette validator against the card surface (all gates pass; the intake green is below 3:1 contrast, relieved by the legend, the selected-day values, and the date table).

Verified locally:

- 12 rule tests: coverage thresholds (7, 28, custom), default anchor ignores today, planned and unconfirmed days, insufficient periods withhold comparisons, custom-range validation, mean/median/population SD/target difference with a high-intake day kept, incomplete days left out with their reason, food-entry source attribution, gross surplus/deficit/net/frequency/ratio including a zero-balance day, an unavailable ratio with no deficit and an uncapped 3000% ratio, matched-day coverage independent of intake coverage, and no period without intake. Chart rows sum to the net metric.
- 5 UI tests (28-day comparison values, selecting a day shows its formulas, Insufficient coverage with charts and dates still shown, custom 75% rule and invalid range, unavailable ratio) and 1 Chromium test at 390px with mocked transport (metrics, tapping a chart column, switching to 7 days, no horizontal overflow); screenshots inspected.
- Full suite: 100 unit/UI/database tests and 8 browser tests pass; typecheck and production build pass (exit codes checked).

Not yet verified: the owner reviewing these numbers against the real imported history on the hosted app.
