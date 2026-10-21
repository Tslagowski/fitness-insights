# 10: Generate an evidence-backed written overview

**Status:** in-progress (deployed 2026-10-21 with ticket 11: Deploy 39534136852; owner review pending)

**What to build:** Open Overview after an import and read concise descriptive findings about intake, weight/activity, and exercise changes, with links to their supporting analysis.

**Blocked by:** 07: Explain intake and modeled energy balance; 08: Compare weight and activity trends; 09: Compare exercise performance and workload.

**Acceptance criteria:**

- [ ] Templates consume the existing calculation results, not independent formulas or paid AI calls. Each supported domain can report even when another has insufficient data.
- [ ] Findings expose actual windows, eligible counts, settings, exclusions, formula/method version, and evidence records.
- [ ] Distinguish source estimates, calculated observations, and unavailable results. Do not prescribe diet/training changes or assert causal explanations/forecasts.
- [ ] Mean and median changes and high-intake contributions can be described without removing large valid days or suggesting they prove a cause.
- [ ] Import changes are separate from period changes. Corrections to old records are not described as recent behavior changes.
- [ ] A generated report records its data/settings revision and cutoff so it can be rendered reproducibly. Sparse data yields explicit unavailable sections, never fabricated findings.

## Implementation evidence (2026-10-20)

Design: `src/analysis/report.ts` (template `overview-v1`) fills fixed sentence templates from `analyzeIntake`, `analyzeTrends`, and `analyzeExercises` over the default 28-day period; it computes nothing independently. Every finding has a kind (calculated observation, MacroFactor source estimate, or unavailable) and evidence (method version, period and previous period, counts, stated values, dates). `reportInputs` records the data revision, report date, period end, per-group cutoffs, settings (duration unit, label band), method versions, review state (excluded, kept, pending weigh-ins; incomplete days), and aliases, so a saved report (ticket 11) can be reproduced; `canonicalJson` gives a key-order-independent form for fingerprints. Import changes are a separate "Data changes (not behavior)" section, and corrections to dates before the period are labeled as such. The Overview shows the report with per-finding Evidence panels and links to the analysis pages; if workout sets cannot load, only the exercise section becomes unavailable.

Verified locally:

- 5 rule tests: statements match the calculations exactly (intake mean/median/shifts, high-intake days kept, source-estimate balance and trend rate, steps, exercise labels) with windows, counts, and methods; sparse data yields explicit unavailable sections and each domain reports independently; no prescriptive, forecasting, or causal wording in any template; corrections to older dates kept apart from recent changes; canonical form is order-independent.
- 2 UI tests (written overview with evidence and page links; workout load failure leaves the rest reporting, with retry).
- Full suite: 131 unit/UI/database tests and 9 browser tests pass; typecheck and production build pass (exit codes checked).

Not yet verified: owner review of the wording against real history on the hosted app.
