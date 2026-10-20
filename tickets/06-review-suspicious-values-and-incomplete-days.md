# 06: Review suspicious values and incomplete days

**Status:** in-progress (deployed 2026-10-20: migration run 39474551550, Check 39474551870, Deploy 39474730495, anonymous access refused; owner review on the hosted app pending)

**What to build:** Open a review queue, keep or exclude a suspicious value, mark a nutrition day incomplete, and inspect which dates/fields are eligible for analysis.

**Blocked by:** 04: Import detailed food records without double-counting.

**Acceptance criteria:**

- [ ] Flag weight more than 10% from the median of at least three prior accepted weigh-ins within seven calendar days; without the baseline, do not fabricate a relative flag.
- [ ] Pending values remain in raw records and are excluded only from dependent calculations. Keeping/excluding a scale value leaves valid food and activity data usable.
- [ ] The confirmed 297.8 lb error is flagged when its preceding baseline is available. Source trend/expenditure affected by an error remains labeled; dropping a scale point does not pretend to repair those estimates.
- [ ] Today is In progress; future dates are excluded; owner-marked incomplete nutrition days are excluded from affected metrics. Unusually high calories are not automatically removed and low intake alone does not establish incompleteness.
- [ ] Review decisions persist across devices and apply to specific source values; replacing a changed value triggers reevaluation. Completeness overrides persist until explicitly changed.
- [ ] Display the imported cutoff/freshness and exclusion reasons. A formerly future prelog does not silently extend confirmed import coverage merely because time passed.
- [ ] Undo and revision history preserve the applicable review/completeness state.

## Implementation evidence (2026-10-20)

Design: eligibility is a pure module (`src/analysis/eligibility.ts`) over saved history, the owner's review decisions, completeness marks, and the reporting date; later analysis tickets consume its per-date results. Decisions are keyed to (date, domain, field, exact value) and marks to (date, nutrition); both are append-only, owner-only logs (`202610200004_review_and_completeness.sql`), latest entry wins, independent of import revisions. Completed-day cutoffs are per kind of data (daily, food, workouts): the Denver date before the latest non-undone import including that kind, capped at yesterday.

Verified locally:

- 10 rule tests: the 297.8 lb scenario flagged at +49.2% vs a 199.6 lb median of five prior weigh-ins; no flag without three accepted weigh-ins in the prior seven days (including a blank one); exactly 10% not flagged; pending/excluded never baseline while kept does; decisions bind to the exact value and the latest wins; today/future/import-cutoff timing including undone imports and late-evening Denver imports; pending/excluded weight leaves intake eligible and labels estimates; incomplete marks affect only intake and revert; food and workout cutoffs are separate.
- 3 database tests: append-only log (no update/delete, invalid domains/statuses rejected); decisions and marks survive an import and its undo; stranger, email-provider owner, and anonymous access denied.
- 4 UI tests (Overview cutoffs and flag; exclude labels the value and the affected estimates and can be reversed; a changed value is reviewed again and a real correction clears the flag; incomplete marking with a failed-save retry) and 1 Chromium test at 390px with mocked transport (exclude, mark incomplete, inserts), screenshots inspected.
- Full suite: 83 unit/UI/database tests and 7 browser tests pass; typecheck and both production builds pass (exit codes checked).

The current 30-day workbook (Sep 20 – Oct 19) does not contain the 297.8 lb weigh-in from the September 13 sample, so it is verified with synthetic data matching that scenario; the full-history workbook check remains a ticket 14 gate.

Not yet verified live: the migration on Supabase and the owner reviewing on the hosted app.
