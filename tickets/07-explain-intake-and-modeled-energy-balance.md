# 07: Explain intake and modeled energy balance

**Status:** ready-for-agent

**What to build:** Use Nutrition & Weight to compare intake distributions, targets, and estimated expenditure over seven-day, 28-day, or custom periods, opening the actual dates behind each metric.

**Blocked by:** 06: Review suspicious values and incomplete days.

**Acceptance criteria:**

- [ ] Calculate mean, median, population standard deviation, and target differences from eligible dates; show counts and source attribution.
- [ ] Compute daily modeled balance on matched intake/expenditure dates, gross surplus, gross deficit, net balance, surplus frequency, and surplus-to-deficit ratio as defined in the specification.
- [ ] A zero gross deficit yields an unavailable ratio, not division by zero. Ratios over 100% are permitted. No modeled balance is asserted to be measured fat change.
- [ ] Default windows end at the latest imported past day with intake; dates/freshness are explicit. Require 21/28 or 5/7 eligible matched days in each period; apply documented custom-window rules.
- [ ] Below coverage thresholds show available records/charts and Insufficient coverage instead of misleading headline comparisons.
- [ ] High-intake observations remain in distributions. Chart selections expose the underlying daily values, exclusions, and formulas; charts and metrics use identical results.
