# MacroFactor Insights Dashboard — Spec

> Working implementation name: Fitness Insights. Owner-approved planning baseline from September 14, 2026, consolidated into this repository on October 19, 2026.
> This specifies the complete v1. Only the account foundation has been implemented locally; it is not a claim that the full app or hosting is complete.

## 1. Summary

Build a single-owner web application that turns weekly MacroFactor exports into reproducible nutrition, weight, activity, and training findings. The most important outcome is an inspectable answer to what changed, accessible across devices with no added recurring cost or paid AI dependency.

## 2. Goals / Non-goals

A personal web application for Trevis to upload MacroFactor exports weekly and inspect reproducible nutrition, weight, activity, and training findings from any device.

The initial product answers:
1. How is weight changing relative to intake and estimated expenditure?
2. Which exercises are progressing, stable, or declining?
3. What changed between recent periods?

Accepted constraints:
- No additional recurring cost, purchased domain, or paid AI calls.
- Vue, TypeScript, Vite, GitHub Pages, and Supabase Free.
- GitHub sign-in restricted to the owner's account; personal data private.
- Minimal maintenance; occasional manual recovery is acceptable.
- Weekly in-app imports, with shared state across devices.
- Descriptive written findings and exploratory charts; no automatic diet/training prescriptions.
- Accumulated historical data plus latest 12 import versions and reports; portable backup.
- America/Denver reporting calendar, Monday-start weeks, original date labels preserved.

Not included initially: embedded AI chat, correlations and causal explanations, forecasts, program editing, notifications, multiple users, inferred body composition, or goal-history reconstruction. The supplied files do not contain historical goals or circumference measurements.

## 3. Users & core flows

The only v1 user is Trevis, authenticated through the configured GitHub owner identity.

### Import and correct history

1. Select any supported combination of workbook, food CSV, and workout CSV.
2. Detect by schema, not filename alone; reject ambiguous or unsupported schemas clearly.
3. Parse without changing current shared records. Show sources, date coverage by domain, validation findings, proposed additions/replacements, and conflicts.
4. Owner confirms the preview.
5. Commit the data revision atomically; regenerate dashboard/report from that revision.
6. Show updated domain freshness, excluded values, and an Undo last import action.

Accepted source authority:
- Workbook: daily measurements, expenditure, targets, and steps.
- Food/workout CSV: corresponding granular detail when supplied; workbook detail is fallback.
- Never concatenate duplicate representations or add workbook totals to their underlying entries.
- Authority operates by domain and explicit date coverage; absent CSV dates do not erase workbook-only history.
- A confirmed newer import may correct covered historical records; outside dates/domains remain unchanged.
- Missing dates do not imply deletion. Explicitly clearing a domain's records for a day is a separate owner action with a preview.
- Reimporting the same effective records must not duplicate entries or create artificial analytical changes.
- Preserve within-day row multiplicity. Two identical logged sets remain two sets.

Proposed reconciliation details:
- Prefer CSV food sums on overlapping dates and retain workbook totals as reconciliation evidence. Use workbook nutrition totals for dates without detailed entries, with source attribution.
- Flag calorie discrepancies exceeding max(5 kcal, 1% of the workbook total); minor rounding differences remain informational. Conflicts require explicit acceptance of the documented source winner before import can proceed.
- Reviewed exclusions attach to the specific source value; a changed replacement value is evaluated anew. Completeness annotations persist until changed by the owner.
- Serialize shared changes through an expected-revision check. A second device with a stale preview must refresh instead of overwriting intervening work.
- Incomplete writes never become the active data revision. Retry must not duplicate a prior successful commit.

### Explore findings and revisit reports

Accepted navigation:
1. Overview: short written summary, major changes, coverage/freshness, and review items.
2. Nutrition & Weight: daily/period charts, intake distribution, source estimates, and supporting dates.
3. Training: exercise selection, progress, working-set counts, and underlying sessions/sets.
4. Imports & Settings: import preview/history, review controls, backups, identity, calendar, and calculation settings.

Proposed interface defaults:
- Responsive navigation and touch-friendly file selection; no required desktop-only workflow.
- Four prominent destinations; show data quality without burying it in settings.
- A finding opens its inputs, dates, formula, exclusions, and source provenance.
- Separate an import change log from period-over-period behavior changes.
- No predicted progress, unsupported diagnosis, or fabricated insights when coverage is insufficient.

Saved reports retain data revision, method version, settings, calendar cutoff, and exclusion/completeness decisions. Later corrections do not silently rewrite older reports. Recalculation is an explicitly new report.

### Recover and move devices

Open the app on another signed-in device and refresh to load the confirmed shared revision. Export a portable backup; validate and preview a restore before replacing state. Resume a paused free service manually and retry safely when needed.

## 4. Requirements

The following functional requirements and calculation definitions are the accepted v1 baseline. Details retaining the word "proposed" were included in the approved specification; they are implementation defaults, except where explicitly identified as provisional or unverified.

### FR1 — Supported sources and provenance

Current samples total 1,514,249 bytes. They demonstrate formats, not the complete intended initial history.

| Source | Observed data |
| --- | --- |
| Workbook | Six sheets; daily summary has 30 rows, August 15-September 13, 2026 |
| Food CSV | 5,064 entries, May 20, 2025-September 18, 2026 |
| Workout CSV | 3,568 sets, January 14-September 12, 2026; 190 observed workout dates |

A full-history workbook will be supplied for initial loading. September 13 workbook weight of 297.8 lb is an owner-confirmed error; a corrected export is outstanding. Do not substitute earlier conversational values into source data. Source trend/expenditure estimates may also need refreshing after a correction.

Workbook tabs: Quick Export; Food Log; Muscle Groups - Sets; Muscle Groups - Volume; Active Program; Workout Log. Archive unused sheets without presenting unsupported analyses.

Both CSVs include a UTF-8 BOM. Preserve quoted text, missing numeric fields, units, source row order, and repeated identical entries. Neither format supplies durable row IDs. Food data has no planned/eaten/completed flag.

### FR2 — Date eligibility, missing data, and review

Accepted:
- Today is In progress, visible separately and excluded from completed-period comparisons.
- Future entries are excluded from completed-consumption analysis.
- Owner can mark historical nutrition days incomplete; missing intake is not zero.
- Suspicious values remain in raw data, are temporarily omitted from dependent calculations, and can be kept or excluded by the owner.
- A weight exclusion does not remove valid food, steps, or workout data on that date.
- All charts/headlines disclose coverage and exclusions.

Accepted standard analysis defaults (supplementary implementation details noted below):
- Anchor calendar comparisons at the last imported past day with intake, never beyond yesterday. Display the actual end date and freshness. A future prelog becoming a past date does not alone establish updated coverage; require a subsequent import covering that day.
- Headline comparison requires at least 21 eligible days in each 28-day window, or 5 in each seven-day window. Proposed custom-window extension: use ceiling(0.75 * window length), with the accepted 7-day and 28-day gates taking precedence for those lengths. These are product heuristics, not statistical confidence thresholds.
- Pair intake and expenditure on the same eligible dates. Independent weight/steps charts keep their own coverage; do not require every domain to exist to show any chart.
- Weight review flag: more than 10% from median of at least three previous accepted weigh-ins within seven calendar days. Without that baseline, do not invent a relative outlier result.
- High calorie intake is an observation to include, not an automatic error. Suspicion of malformed units/values is distinct from an unusually large valid meal/day. Low intake alone does not establish incomplete logging.
- Nonfinite or structurally invalid numeric fields remain unavailable with validation evidence; never coerce to zero.

### FR3 — Nutrition, weight, and activity

Accepted analyses: means, medians, variability, target differences, estimated energy balance, surplus-day frequency/magnitude, weight and activity changes, and period comparisons.

Proposed deterministic definitions:
- Mean intake: sum of eligible intake / eligible day count.
- Median intake: median of eligible daily intake.
- Variability: population standard deviation of eligible daily intake in the displayed finite period.
- Mean target difference: mean(intake - target) on eligible matched dates.
- Daily modeled balance: intake - source expenditure estimate; positive is surplus, negative is deficit.
- Gross modeled deficit: sum(max(expenditure - intake, 0)).
- Gross modeled surplus: sum(max(intake - expenditure, 0)).
- Net modeled balance: gross surplus - gross deficit.
- Surplus-to-deficit ratio: gross surplus / gross deficit, only when gross deficit is greater than zero. May exceed 100%; do not cap it or claim these estimates are actual tissue changes.
- Surplus-day frequency: days with positive balance / eligible matched days.
- Mean/median shifts: report both, showing whether upper-tail intake differs between windows without claiming a cause.
- Weight: show raw scale points and source trend values separately. Proposed weekly trend rate is seven times the least-squares slope of available eligible source trend values against elapsed calendar days; require the period coverage gate. Do not interpolate missing data silently.
- Steps: daily points, period average over observed eligible days, and explicit coverage.

Do not convert summed balance into asserted pounds of fat, recreate MacroFactor's estimator, or call an association a causal explanation. A source estimate affected by a suspect weigh-in remains labeled and warned about until refreshed; removing a scale point does not repair that estimate.

### FR4 — Exercise performance and workload

Accepted logging conventions:
- Dumbbell weights are per hand; unilateral reps are per side. Never double them automatically.
- Use only Weight (lb). Do not add Exercise Base Weight (lb), machine resistance, or inferred body weight, including hack squat and glute ham raises.
- Preserve source base weight as metadata only.
- Equipment/movement variants stay separate. Cosmetic aliasing must be explicit.
- Assisted movements are assessed through assistance and reps; timed movements through duration.
- Compare latest three with preceding three comparable sessions. Fewer than six produces Insufficient data for the label; raw history remains visible.

Accepted estimated-strength scoring defaults:
- Positive-load exercises: highest qualifying set score per session, then median score in each three-session group.
- Qualifying estimated-strength sets: positive logged load, 1-10 reps, Standard Set or Failure Set; exclude Warm-Up Set. No RIR correction.
- Estimated-strength score = logged load * (1 + reps / 30). This is a transparent performance estimate, not a measured maximum. It uses per-hand load where that is how the exercise is logged.
- Relative change = (recent median / previous median - 1) * 100, only for positive previous median.
- Accepted label band: above +2.5% Progressing; below -2.5% Declining; otherwise Stable. This is an adjustable display heuristic, not statistical significance or a physiological diagnosis.

Supporting training behavior (implementation defaults for final review):
- Also show reps at comparable loads; do not hide meaningful rep progression behind one score.
- No positive-load strength score for assisted, bodyweight-only, zero-load, or timed movements. Show assistance/reps or duration directly. Mixed trade-offs stay visible rather than forcing a misleading label.
- Weekly set count excludes warm-ups and includes valid logged work sets. Missing load does not erase a legitimate set.
- Optional load-times-reps series uses only eligible nonnegative logged load and reps, clearly labeled logged-load volume. It is not total mechanical work, excludes unsupported assisted/timed records, and is not compared across exercises.
- Source Muscle Groups - Volume is not interchangeable with logged-load volume. Defer it until source accounting is verified; do not introduce machine/bodyweight assumptions through that sheet.

Source limitations and provisional assumptions:
- Workout identifiers are Date, Workout, and Workout Duration; no durable session ID/start timestamp. This sample has one distinct pair per date. Two identical named/equal-duration workouts on one date cannot be reliably distinguished. Proposed MVP groups that tuple and discloses this limitation; no adherence claims against a planned schedule.
- Workout Duration and Duration have no stated units. The owner believes the values are seconds; use seconds provisionally and retain the raw values plus an explicit unit-assumption setting. Do not describe the unit as verified. Check one workout against the app display before release; 2912 seconds would display as 48 minutes, 32 seconds. Duration repeats per workout set and must not be summed as session duration. If the unit assumption changes, regenerate duration outputs with a new method/settings version while preserving previous report snapshots.

### Non-functional requirements

- Responsive, touch-friendly imports and review on a phone, plus desktop access.
- Reproducible calculation outputs shared by charts and written summaries.
- Zero added recurring cost: no paid model calls, purchased domain, or automatic paid upgrade.
- Private records and raw sources protected by database/storage rules, including direct API requests.
- Preserve active data and retained recovery state on network, quota, staging, or restore failure.
- Minimal maintenance, with honest manual recovery guidance for paused free services.

## 5. Technical approach

- Frontend: Vue, TypeScript, Vite; static deployment to GitHub Pages.
- Calculations: pure, independently testable browser-side functions with versioned methods/settings.
- Backend services: Supabase Free authentication, database, and private source storage; GitHub OAuth restricted through a configured owner allowlist.
- No AI API is required. Existing ChatGPT/MacroFactor subscriptions do not create an API integration or token budget.
- A public frontend repository contains code and synthetic fixtures only. Raw personal exports are uploaded privately through the app.
- Browser storage alone does not satisfy the accepted cross-device requirement; the static frontend can coexist with a separate managed backend.

Accepted: owner-only access, current historical data, 12 import versions/reports, shared device access, portable backup, free-tier limits.

Proposed logical entities: Owner; ImportBatch; SourceFile; DataRevision; DailyMeasurement; DailyNutrition; FoodEntry; WorkoutSession; WorkoutSet; ExerciseIdentity; ReviewDecision; CompletenessOverride; ReportSnapshot; AnalysisSettings.

Storage/implementation details to specify during implementation planning:
- Restrict all personal data and file access at the database/storage layer to the configured owner identity. Hiding UI or possession of a frontend key is not access control.
- No service-role key or exports in the public repository, static output, or public demo fixtures.
- Private raw source archives plus normalized records and provenance. Report snapshots may reference immutable versions; retention must preserve reconstructability.
- Backup contains accumulated records, settings, provenance, review decisions, supported version history, and checksums, but no credentials. Restore must validate and preview before replacing current state.
- Quota-aware writes must preserve active data on failure. Block rather than incur charges, silently drop historical data, or prune below accepted retention without explicit owner action.
- Staged upload cleanup must never remove referenced source data. Prune only superseded versions older than the retained set after successful commit.
- Free service pause: provide an actionable resume/retry message; do not claim a failed save succeeded. Offline synchronization is not promised in the MVP.

## 6. Milestones

Implement the approved vertical slices in dependency order. Full acceptance details and blockers are retained in [planning notes](https://github.com/Tslagowski/ideas/blob/main/ideas/macrofactor-dashboard/notes.md).

| Ticket | Deliverable | Status at consolidation |
| --- | --- | --- |
| 01 | Owner sign-in, private preference, navigation | Done; live verified 2026-10-19 |
| 02 | Workbook daily-history import | Done; live verified 2026-10-19 |
| 03 | Historical corrections and undo | Done; live verified 2026-10-20 |
| 04 | Detailed food import without double-counting | Done; live verified 2026-10-20 |
| 05 | Workout import preserving logging conventions | Done; live verified 2026-10-20 (duration check is a ticket 14 gate) |
| 06 | Suspicious-value and incomplete-day review | Implemented; live verification pending |
| 07 | Intake and modeled energy balance | Implemented; owner review pending |
| 08 | Weight and activity comparisons | Implemented; owner review pending |
| 09 | Exercise performance and workload | Implemented; owner review pending |
| 10 | Evidence-backed written overview | Implemented; owner review pending |
| 11 | Immutable report/import history | Implemented; owner review pending |
| 12 | Portable backup and restore | Implemented; owner review pending |
| 13 | Service/quota failure recovery | Implemented; owner review pending |
| 14 | Complete mobile and cross-device release verification | Automated checks done; owner verification and two external gates pending |
| 15 | Record daily energy (owner idea) | Deferred until after the backlog; five levels accepted; comparison scope undecided |
| 16 | Detect weight phases and plateaus | Implemented; owner review pending (issue #1) |
| 17 | Track expenditure relative to body weight | Implemented; owner review pending (issue #2) |
| 18 | Show day-of-week nutrition and weight patterns | Implemented; owner review pending (issue #3) |
| 19 | Explain over-target days from food detail | Implemented; owner review pending (issue #4) |
| 20 | Track protein relative to body weight | Implemented; owner review pending (issue #5) |
| 21 | Compare strength with body weight during weight change | Implemented; owner review pending (issue #6) |
| 22 | Show muscle-group balance and stalled lifts | Implemented; owner review pending (issue #7) |
| 23 | Track training effort and rep ranges | Implemented; owner review pending (issue #8) |
| 24 | Find what precedes your best and worst sessions | Implemented; owner review pending (issue #9) |
| 25 | Add long-range reviews and dated notes | Implemented; owner review pending (issue #10) |
| 26 | Make data lists readable on phones | Implemented; owner review pending (issue #11) |
| 27 | Import the full MacroFactor data export | Implemented; owner import pending (issue #12) |
| 28 | Turn the Overview into a glance dashboard | Implemented; owner review pending (issue #13) |
| 29 | Slim the page header | Implemented; owner review pending (issue #14) |
| 30 | Install as a home-screen app | Implemented; owner review pending (issue #15) |
| 31 | Split long pages into tabs | Implemented; owner review pending (issue #16) |
| 32 | Show Insights as a grid of summary cards | Implemented; owner review pending (issue #17) |
| 33 | Tuck method labels and fine print behind an info control | Implemented; owner review pending (issue #18) |
| 34 | Add icons to the bottom navigation | Implemented; owner review pending (issue #19) |
| 35 | Support dark mode | Implemented; owner review pending (issue #20) |
| 36 | Make charts touch-friendly | Implemented; owner review pending (issue #21) |
| 37 | Unify the visual style | Implemented; owner review pending (issue #22) |
| 38 | Make daily list rows more informative | Ready (issue #23) |
| 39 | Organize Settings into sections | Implemented; owner review pending (issue #24) |

## 7. Acceptance criteria

1. All three supplied schemas parse with original units and row multiplicity preserved; the full-history workbook receives an additional verification pass when supplied.
2. Reimporting an unchanged batch yields no duplicates and no artificial change report.
3. Updating a represented day corrects that domain while preserving other days/domains. A missing date does not delete data.
4. CSV/workbook overlap does not double totals or sets. Source precedence and conflicts are inspectable.
5. An import failure leaves the prior revision usable; undo restores the preceding data state and associated review state.
6. Concurrent stale previews cannot overwrite a newer confirmed revision.
7. Future/today/incomplete days and reviewed values follow eligibility rules; zero and missing remain distinct.
8. The confirmed erroneous weigh-in triggers review under the accepted relative rule when the preceding baseline is available; unrelated daily fields remain usable.
9. Dumbbell load/reps are never doubled; machine/base/body weights are never added. Negative assistance is not scored as positive resistance.
10. Six-session comparison and sparse-data behavior match documented definitions, with exact input records exposed.
11. Findings and charts use the same calculation outputs, matched dates, settings, and revision.
12. Unauthorized identities cannot read/write personal records or archives, including through direct data requests.
13. An import on one device is visible after refresh on another. Mobile import and review are usable.
14. Backup/restore round-trips retained data without credentials or lost exclusions; quota/paused-service errors preserve existing data.
15. No paid API call, paid domain, or automatic paid service upgrade is part of the workflow.
16. Duration conversion preserves raw values and exposes the provisional unit assumption; verify it against an app-displayed session before release. A later unit change cannot silently rewrite saved reports.

## 8. Risks & open questions

- The dedicated application repository is Tslagowski/fitness-insights. A Supabase project, verified owner enrollment, OAuth callbacks, and live Pages deployment remain to be configured/verified. The ideas repository stores the planning history; Tslagowski/fitness-insights is the application repository.
- Verify a corrected full-history workbook before claiming historical daily coverage. The September sample and its known error are evidence for parser/review behavior, not the intended full initial history. Newly supplied exports must be inspected independently.
- Duration units remain provisional. Preserve raw values and the configurable interpretation; verify one session against the source app before release.
- No durable entry/session IDs are available. Preserve legitimate duplicate rows and disclose same-day session-grouping ambiguity.
- Expenditure and trend weight are source estimates. A corrected scale point does not automatically repair previously exported estimates.
- Free-tier availability and quotas may interrupt use. Validate capacity at deployment without paid upgrades or silent history loss.
- Historical conversation analyses are motivation, not trusted source records or proof of physiological causes.

## 9. Agent instructions

- Follow this specification and the approved backlog; do not repeat discovery or reopen accepted logging conventions without a concrete conflict.
- Application implementation belongs in Tslagowski/fitness-insights. Keep Tslagowski/ideas as the idea/specification backlog.
- Use readable TypeScript names and separate source adapters, pure calculations, persistence, and presentation.
- Test behavior through meaningful public boundaries: import/reconciliation cases, calculation eligibility, direct database/storage access, failure recovery, and relevant UI flows.
- Use synthetic public fixtures. Do not commit personal XLSX/CSV exports or privileged credentials.
- Do not describe mocked browser transport checks as live OAuth or actual hosted synchronization.
- Existing application verification commands: `npm ci`, `npm test`, `npm run typecheck`, `npm run build`; install Playwright Chromium before `npm run test:browser`.
- Current recorded verification is seven UI/database tests, three mocked-transport browser tests, typecheck, and production builds passing on September 17, 2026. Re-run relevant verification when implementation changes.
- Record unresolved release gates honestly. Do not infer missing historical data, change raw logged units, or enable paid services to make an acceptance criterion appear complete.
