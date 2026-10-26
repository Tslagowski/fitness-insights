# Fitness Insights

A personal Vue/TypeScript/Vite workspace for nutrition and training analysis from MacroFactor exports, hosted on GitHub Pages with Supabase Free at https://tslagowski.github.io/fitness-insights/. It covers owner-only GitHub sign-in; workbook, food CSV, and workout CSV imports with previews, corrections, undo, and a private archive of the original files; review of suspicious weigh-ins and incomplete days; intake, modeled energy balance, weight, steps, and exercise progress analysis; an evidence-backed written overview with immutable saved reports; version retention; portable backup and restore; and free-tier capacity protection with recovery guidance. See [docs/operations.md](docs/operations.md) for the weekly routine, limitations, recovery, retention, and portability.

## Run locally

Use Node 24 and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Without Supabase values, the app opens a setup screen. Set the project URL and publishable key in `.env.local` to enable sign-in. Never use a service-role/secret key or a GitHub OAuth secret in a `VITE_` variable.

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

Database tests run the actual migration against embedded PostgreSQL with representative Supabase auth claims. Browser tests stub Supabase's network boundary; they verify the real frontend and adapter, not live GitHub login or cloud synchronization. Hosted verification remains separate.

## Connect the free services

1. Create/select your Supabase Free project. Do not enable a paid plan. Database changes are applied by the `Database migrations` GitHub Actions workflow (see "Database changes" below); add its two secrets first. The migrations initially allow nobody to access app data. (Fallback without the workflow: run each file in `supabase/migrations/` once in the SQL editor, in filename order.)
2. Create a GitHub OAuth application. Its authorization callback is the Supabase callback shown under Authentication / Providers / GitHub, usually `https://PROJECT_REF.supabase.co/auth/v1/callback`. Put the OAuth client ID and secret in Supabase only.
3. Enable GitHub in Supabase. Disable unneeded sign-in providers. Under authentication URL settings, allow your exact app root, including repository path and trailing slash, plus your local development root if needed. For a repo named `fitness-insights`, examples are `https://OWNER.github.io/fitness-insights/` and `http://localhost:5173/`. Set the production root as Site URL. Do not use a separate `/auth/callback` frontend route; GitHub Pages serves the app root and navigation uses hashes.
4. Copy the Supabase project URL and `sb_publishable_...` API key into `.env.local`. Set `VITE_BASE_PATH=/` for local root or `/fitness-insights/` to test that subpath.
5. Sign in once using your own GitHub account. The app will correctly deny access until you enroll that verified identity. In Supabase's Authentication / Users view, identify your own GitHub user and copy its Supabase UUID. Do not choose a user merely because it registered first.
6. Run the following in the Supabase SQL editor, replacing the placeholder with that verified UUID:

```sql
insert into private.app_owner (user_id)
values ('YOUR_VERIFIED_SUPABASE_USER_UUID'::uuid)
on conflict (singleton) do update set user_id = excluded.user_id;
```

7. Reload the app. Open Imports & Settings, change display density, save, and confirm it on a second signed-in browser. Non-owner accounts must see Access denied; they also cannot query or modify preferences directly.

The private owner allowlist can only be edited administratively. Database policies check both the configured user UUID and the authenticated GitHub provider, using trusted auth claims. Auth may issue a session to other GitHub accounts, but those accounts receive no application data access. Signing out removes the current device session without signing out your other devices.

## GitHub Pages

1. Create/select the public code repository for the agreed free Pages setup. This package includes no private exports. Do not add those files or credentials.
2. Add repository Actions variables: `VITE_BASE_PATH` (for example `/fitness-insights/`), `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. An account-level `OWNER.github.io` repository uses `/` instead. These are public build values, not privileged secrets.
3. Under repository Settings / Pages, select GitHub Actions as the build source.
4. Run the `Deploy GitHub Pages` workflow manually. It validates configuration, tests, builds, and deploys only static output. OAuth configuration must match the final Pages URL.
5. Verify sign-in, a saved preference after reload, and another-device access at the live URL. A successful local build is not proof these hosted checks passed.

No custom domain, paid model API, or paid hosting is needed. If the free database pauses, resume it in Supabase and retry. The app does not pretend failed saves succeeded. Public code updates use the included Check workflow; publishing is a separate explicit manual workflow.

## Architecture and scope

- `src/App.vue`: account lifecycle, navigation, settings, empty states.
- `src/supabase-gateway.ts`: OAuth, preference, archive upload, and import transport.
- `src/import/`: workbook reading (`xlsx.ts`), CSV reading (`csv.ts`), MacroFactor daily records (`workbook.ts`), food entries (`food.ts`), workout sets and sessions (`workout.ts`), multi-file import plans (`sources.ts`), and preview helpers (`preview.ts`).
- `src/analysis/eligibility.ts`: completed-day eligibility, import cutoffs, weight review flags, and completeness (ticket 06), shared by later analysis.
- `src/analysis/periods.ts`: shared 7/28/custom periods, coverage gates, and the least-squares slope.
- `src/analysis/trends.ts`: scale weight, trend-weight rate, and steps per period (ticket 08).
- `src/analysis/exercise.ts`: exercise progress labels, movement semantics, and weekly working sets (ticket 09).
- `src/analysis/report.ts`: the written overview built from the ticket 07-09 results (ticket 10).
- `src/analysis/intake.ts`: intake distribution, target difference, and modeled energy balance per period with coverage gates (ticket 07).
- `src/backup/`: the portable backup format with checksums (`backup.ts`) and free-tier capacity checks (`capacity.ts`) (tickets 12-13).
- `src/components/`: the data status, review queue, and incomplete-days panels, the import panel, daily history table, food log, training log with exercise aliases, Correct a day panel, and change history with Undo.
- `supabase/migrations`: owner allowlist, row-level access rules, revisioned daily history with the atomic `commit_import` function, and the private source archive bucket.
- `tests`: UI behavior, actual database policy tests, browser transport tests.
- `tickets`: approved work and blocking dependencies; tickets 01 and 02 are done; ticket 03 is done; ticket 04 is done; ticket 05 is done; ticket 06 is deployed and awaiting owner review; tickets 07-13 are implemented and awaiting owner review; ticket 14 awaits owner verification.
- `CONTEXT.md` and `docs/adr`: terminology and selected architecture.

Dependencies are pinned with a lockfile. TypeScript is pinned to a version compatible with the installed Vue type checker. Preferences are fetched on page load/auth changes; another device sees the new value on refresh, not via a realtime subscription.

## Primary references

- [Supabase GitHub authentication](https://supabase.com/docs/guides/auth/social-login/auth-github)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages)

Live setup requires the owner's GitHub repository, Supabase project, and OAuth configuration. The application source is published at https://github.com/Tslagowski/fitness-insights. The Supabase Free project and Pages deployment were provisioned and verified on 2026-10-19; see the ticket 01 evidence.

## Continue development on the MacBook

The approved build contract is [SPEC.md](SPEC.md); the implementation backlog is in [tickets/](tickets/). The original idea and planning history remain in [Tslagowski/ideas](https://github.com/Tslagowski/ideas/tree/main/ideas/macrofactor-dashboard).

```bash
git clone https://github.com/Tslagowski/fitness-insights.git ~/Projects/fitness-insights
cd ~/Projects/fitness-insights
npm ci
npm test
npm run build
npm run dev
```

Use Node 24. If the target folder already exists, inspect it before cloning or replacing anything. The app shows a setup screen until Supabase is configured; that is expected. Developing on this Mac does not require hosting the production app there. GitHub Pages and Supabase remain the selected hosting architecture.

The initial remote snapshot incorporates local source commit `e091c6e` plus the specification and handoff documentation. Prior local commits were packaged as a source snapshot rather than transplanted into this repository's history.

### Keep the dev server running for phone access

To work from your phone while the Mac stays at home, run the dev server as a launchd service instead of an open Terminal window:

```bash
deploy/macos/install_dev_server.sh            # install/update; starts at login, restarts if it exits
deploy/macos/install_dev_server.sh uninstall  # remove it
tail -f .logs/dev-server.log                  # server output
```

Stop any `npm run dev` Terminal session first; the script refuses to start if port 5173 is taken. It pins your nvm Node 24 binary, runs `npm ci` when dependencies are missing or stale, and prints the Tailscale link for your iPhone (install Tailscale on both devices, same account). Keep the Mac awake while plugged in. If file edits don't appear on refresh, reinstall with `POLLING=1 deploy/macos/install_dev_server.sh`. For GitHub sign-in from the phone, give the dev server an HTTPS hostname with free Tailscale Serve (enable MagicDNS and HTTPS Certificates in the Tailscale admin DNS page first):

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 5173   # prints https://<host>.<tailnet>.ts.net/
```

Add that exact `https://…ts.net/` address (trailing slash) to Supabase's redirect URLs. Do not use a bare `http://100.x.y.z:5173/` address: Supabase's firewall blocks sign-in redirects to raw IP addresses. This is a development convenience only; it does not change the GitHub Pages plus Supabase Free hosting.

## Workbook imports (ticket 02)

In Imports & Settings, choose a MacroFactor `.xlsx` export. The app reads it in the browser and recognizes the daily summary sheet by its columns (not the file or sheet name). It then shows a preview before anything is saved: date coverage per domain, new/corrected/unchanged record counts, any invalid values, how each sheet is handled, and the daily values. Confirming uploads the raw file to the private `source-archives` bucket (content-addressed, immutable) and calls `commit_import`, which:

- runs in one transaction and only for the enrolled owner;
- replaces only the dates and domains the workbook represents, leaving absent dates untouched;
- creates a new data revision only when something changed; an identical reimport is recorded as "no changes";
- rejects a preview prepared against an older revision (for example after another device imported), so the app refreshes the preview instead of overwriting;
- returns the original result when a request is retried, so a lost response cannot create a duplicate.

The full data export (one sheet per measure) is also accepted (ticket 27): its weight, trend, expenditure, nutrition, and steps sheets become the same daily records, daily targets are derived from the nutrition program history (latest update on or before each day, by weekday), and days you flagged as Partial Logging can be marked incomplete in the preview. Profile and settings sheets are kept only in the private archive and never read; the full export has no food entries or workout sets, so import the CSVs for those.

Blank cells stay missing, never zero. Workbook nutrition totals are provisional until detailed food imports (ticket 04). Food Log and Workout Log sheets are reported but not imported yet; muscle-group and program sheets are archived with the raw file only.

## Database changes

Schema changes live in `supabase/migrations/` and are applied by the **Database migrations** workflow (`.github/workflows/migrate.yml`) using the free Supabase CLI. Nothing needs to run on a personal computer.

- It runs automatically when a migration file changes on `main`, and manually from Actions > Database migrations > Run workflow (with an optional dry run that only lists pending migrations).
- It first runs the database tests against embedded PostgreSQL, then `supabase link` and `supabase db push`. The CLI records applied versions in `supabase_migrations.schema_migrations`, runs only new files in filename order, and wraps each file in a transaction, so a failing migration leaves the database unchanged.
- One-time setup in GitHub repository Settings > Secrets and variables > Actions > **Secrets**:
  - `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token (supabase.com/dashboard/account/tokens).
  - `SUPABASE_DB_PASSWORD`: the project's database password (Project Settings > Database; reset it there if lost).
  The project ref comes from the existing `VITE_SUPABASE_URL` variable.
- Write new migrations as new files with a later numeric prefix. Never edit a migration that has already been applied, except to make it safely re-runnable with the same result (as was done for the hand-applied baseline `202609150001_owner_preferences.sql`).
- Deploy the frontend (Deploy GitHub Pages) after the migrations it depends on have succeeded.

## Corrections and undo (ticket 03)

Every shared change is append-only: an import, a cleared day, or an undo creates a new data revision, and earlier records are only marked with the revision that retired them, so any earlier version can be reconstructed.

- **Overlapping imports** preview new, corrected, and unchanged records (with before/after values) and state how many saved dates outside the file stay untouched.
- **Correct a day** (Imports & Settings) clears one domain on one date after a confirmation step, via `clear_day`. Other domains on that date and all other dates are unchanged. Re-importing a workbook that contains the date adds it back.
- **Undo** reverts the latest import or correction that has not been undone, via `undo_last_change`, restoring exactly the records that were active before it. A dry run previews what will be restored, reverted, or removed. Repeating Undo steps further back.
- **Change history** lists imports, clears, and undos in plain language and marks undone changes.
- Clear and undo use the same stale-preview check and retry-safe request ids as imports.

## Food detail (ticket 04)

Choose the workbook, the food CSV, or both in one import. Files are recognized by content and headers. Each date's food entries are saved as one food day, exactly as exported: source order, original column labels and units, and legitimately identical rows; a blank nutrient is absent (not recorded), never zero.

- **Precedence:** the food CSV is authoritative for any date it covers; the workbook's Food Log fills dates without CSV detail. A later workbook-only import never replaces saved CSV detail (the preview reports those dates as kept). A newer import replaces a date's food entries as a whole; dates it does not contain are untouched, and food-only imports never touch weight, expenditure, targets, or steps.
- **Daily intake** is the sum of the date's food entries when detail exists, otherwise the workbook daily total, always labeled by source. The two are never added together; workbook totals stay saved as reconciliation evidence.
- **Reconciliation:** on dates an import touches, a difference between the detail calorie sum and the workbook total above max(5 kcal, 1%) is listed in the preview. `commit_sources` refuses the import (`FI422`) until the owner accepts the food detail as the source; accepted differences are stored with the change.
- **Planned entries:** food dated after today (America/Denver) is saved and labeled Planned, not treated as eaten. Completed-day eligibility arrives in ticket 06.
- `commit_sources` handles one workbook and/or one food CSV atomically with the same stale-preview check and retry-safe request id as before, plus a dry run used by the preview. Raw CSVs are archived privately under `food-csv/`. Clearing (`food_entries`) and Undo cover food days. Nutrition & Weight shows intake with its source and a food log whose entries load per day.

## Workouts (ticket 05)

The import also accepts the MacroFactor workout CSV (alone or with the other files), and the workbook's Workout Log sheet. Each date's sets are saved as one workout day, exactly as logged and in source order, keeping legitimately identical sets.

- **Logging conventions are preserved:** `Weight (lb)` stays as logged (dumbbells per hand; never doubled), `Reps` as logged (per side for unilateral movements), negative weight is machine assistance, blank load/reps/RIR stay not recorded, timed sets keep `Duration`, and `Exercise Base Weight (lb)` is shown as metadata and never added to the load.
- **Precedence:** the workout CSV is authoritative for any date it covers; the workbook Workout Log fills dates without CSV detail and never replaces saved CSV detail. Dates absent from an import are untouched.
- **Sessions** are grouped by date, workout name, and workout duration (the export has no session ID, so identical same-day sessions appear as one, as disclosed in the app). Session duration is the logged value, never a sum across sets.
- **Durations** keep raw values; the app reads them as seconds by default, a provisional, owner-changeable setting (Imports & Settings) shown as unverified until one session is checked against MacroFactor (release gate in ticket 14).
- **Exercise names** stay separate; an owner-chosen display alias (`exercise_aliases`) can group a rename or a superset label (for example "Hack Squat ∈ SS1") without changing raw records, and can be removed.
- Workout import, clearing (`workout_sets`), reimport, and Undo use the same revisioned workflow as daily and food records. Raw workout CSVs are archived privately under `workout-csv/`.

## Review and completed-day eligibility (ticket 06)

`src/analysis/eligibility.ts` decides, reproducibly from saved history, owner decisions, and the America/Denver date, which values count for completed-day analysis and why others do not. Raw records are never edited.

- **Weight review:** a weigh-in more than 10% from the median of at least three previously accepted weigh-ins within the prior seven calendar days is flagged and left out of weight calculations until the owner keeps or excludes it (Overview > Review queue). Pending and excluded values never form a baseline; kept values do. Without a baseline, no relative flag is produced. Decisions apply to the exact saved value, so a value changed by a later import is checked again.
- **Source estimates:** while a flagged weigh-in is not kept, MacroFactor's trend weight and expenditure from that date onward are labeled (†) as possibly affected; excluding a scale point does not pretend to repair them.
- **Incomplete days:** the owner can mark a day's nutrition logging incomplete (Overview), which leaves only that day's intake out; low intake is never assumed incomplete and high intake is never removed automatically.
- **Timing:** today is in progress and later dates are planned. Completed-day cutoffs come from the latest (not undone) import that included each kind of data: the day before that import, never after yesterday. A pre-logged day is not confirmed by time passing alone.
- Decisions and completeness marks are append-only owner logs (`review_decisions`, `completeness_marks`, read through `review_state()`); the latest entry per value or date wins. They are not part of import revisions, so importing, clearing, and Undo never remove them.

## Intake and modeled energy balance (ticket 07)

Nutrition & Weight opens with **Intake and modeled energy balance**, computed by `src/analysis/intake.ts` (method `intake-balance-v1`) from the ticket 06 eligibility results. No database change.

- **Periods:** 7 days, 28 days (default), or a custom range of up to 366 days ending before today. Each is compared with the same number of days immediately before it. The 7- and 28-day periods end at the latest past day with imported intake that a later import has confirmed; the end date and data freshness are shown.
- **Counted intake** uses eligible days only (food entries when present, otherwise the workbook total; days marked incomplete, today, planned and unconfirmed days are left out with their reason). High-intake days always stay in.
- **Metrics:** mean, median, population standard deviation, and mean difference from target; on matched days (counted intake and an eligible expenditure estimate on the same date): net, gross surplus and gross deficit, surplus-day frequency, and surplus ÷ deficit (unavailable when there is no deficit; may exceed 100%).
- **Coverage:** each period needs 5 of 7 or 21 of 28 days, otherwise 75% of its length rounded up: counted days for intake metrics, matched days for balance metrics. Below that, the headline reads Insufficient coverage, comparisons are withheld, and the charts and date list stay available.
- **Charts** (intake columns with expenditure and target lines; daily modeled balance) read the same rows as the metrics. Tapping a day, or using the arrow keys, shows its values, status, and formulas. "Dates behind these numbers" lists every date in the period, and "How these are calculated" lists the formulas.
- Modeled balance is labeled as an estimate built from MacroFactor's expenditure estimate, never as measured fat or weight change.

One period picker at the top of Nutrition & Weight scopes every section, so they always describe the same dates.

## Weight and activity (ticket 08)

`src/analysis/trends.ts` (method `weight-activity-v1`) reads the same eligibility results and period:

- **Scale weight** points and MacroFactor's **trend weight** are separate series; the trend is never rebuilt from weigh-ins. Pending or excluded weigh-ins are drawn hollow and left out of the average. Missing days stay gaps.
- **Trend weight rate** is 7 × the least-squares slope of eligible trend values against elapsed calendar days, shown only when the period passes the coverage gate.
- **Steps** average observed eligible days only, with their own coverage; missing nutrition or workouts never hides weight or steps (when no intake exists, the period ends at the latest confirmed day with weight or steps).
- Trend values that may reflect a questioned weigh-in keep their † warning after a scale value is excluded.
- Tapping a day shows its scale, trend, and steps values with their status; the date table and formulas are listed below the charts.

## Exercise progress (ticket 09)

Training opens with **Exercise progress**, computed by `src/analysis/exercise.ts` (method `exercise-v1`) over every active workout set (`active_workout_sets()`), on completed days confirmed by an import only.

- **Score:** logged load × (1 + reps ÷ 30) for qualifying sets (positive load, 1–10 reps, Standard or Failure; never warm-ups). Loads and reps are used exactly as logged (per hand, per side); base, machine, and body weight are never added; no RIR correction.
- **Label:** best qualifying set per session, median of the latest 3 sessions vs the 3 before. Above +band Progressing, below −band Declining, otherwise Stable (band 2.5% by default, adjustable in Imports & Settings and saved as `preferences.strength_band_percent`). Fewer than 6 qualifying sessions: Insufficient data.
- **Movement types:** assisted (negative weight), bodyweight or zero-load, and timed movements are not scored and show least assistance, reps, or duration. Movements mixing positive loads with assisted or timed sets get no single label.
- **Evidence:** the compared sessions with dates, best set, score, working sets, and logged-load volume; reps at loads used in both groups; a score chart with group medians. Display aliases group logged names explicitly and list them.
- **Weekly working sets** count every non-warm-up set (blank-load sets included) per Monday-start week; weeks not yet confirmed by an import are marked.


## Written overview (ticket 10)

Overview opens with a **Written overview** generated by `src/analysis/report.ts` (template `overview-v1`) from the same results as the charts, for the latest 28 completed days vs the 28 before. No AI or paid service is involved.

- Sections: intake (mean, median, target difference, and which highest-intake days differ when the mean and median move apart, all still included), modeled balance, weight, steps, exercise progress, and data changes.
- Each statement is marked as calculated from your records, using a MacroFactor estimate, or unavailable, and has an Evidence panel with its period, counts, values, dates, and method version, plus a link to the page with the charts.
- Sparse data produces explicit "insufficient coverage" or "unavailable" statements; each section reports independently.
- Imports and corrections appear only under "Data changes (not behavior)"; a correction to dates before the current period is labeled as such.
- No advice, forecasts, or causal claims (enforced by a test over every template).

## Saved reports and retention (ticket 11)

- **Saved reports:** whenever the overview's inputs or findings change (data version, period end, cutoffs, settings, review decisions, aliases, or method versions), opening Overview saves it through `save_report` as an immutable snapshot of its full content and inputs. The fingerprint ignores only the day it was viewed, so revisiting an unchanged overview saves nothing new. Reports cannot be edited; an incomplete overview (workout sets failed to load) is not saved.
- **Browse and compare:** Overview > Saved reports opens any retained report exactly as saved and compares it with the current overview, listing input changes (imports and corrections between the two data versions, settings, review decisions, methods) separately from changed findings.
- **Retention:** Imports & Settings > Version retention previews, then (after you confirm) runs `prune_history`, which keeps the latest 12 data versions and their reports and removes only records superseded before them plus reports for older versions. Current records, import history, and the original export files are never removed, and nothing is pruned automatically. Undo stops at the oldest retained version (`FI410`).

## Backup and restore (ticket 12)

Imports & Settings > Backup and restore.

- **Download backup** produces `fitness-insights-backup-YYYY-MM-DD.zip`: `manifest.json` (format 1, row counts, active and retained revisions, display preferences, and a SHA-256 for every file), one JSON file per table from `export_backup()` (every retained row, including superseded history, import provenance, review decisions, completeness marks, aliases, and saved reports), and the original exports under `archives/`. It contains no credentials, keys, or account ids. If any part cannot be read, no file is offered.
- **Restore** checks the whole file first (ZIP, format, every checksum, row counts, and each original export against its recorded fingerprint) and the free-tier capacity, then shows current vs backup contents. Only after you confirm does it store the original exports (content-addressed, so existing ones are kept), upload the rows in chunks to private staging (`stage_restore_chunk`), and call `apply_restore`, which re-checks the counts and the revision and replaces everything in one transaction. Display preferences are then saved for the signed-in owner. An interrupted, stale, or failed restore replaces nothing; its staging is discarded (or expires after a day).

## Phone-readable lists (ticket 26)

On phones (below 760px), wide tables become month-grouped rows: a short date ("Wed 21"), one main value, a line of secondary values, and every field on tap. Daily history has an Intake / Weight / Activity switch and loads 30 days at a time. Wide screens keep the full tables.

## Insights page (tickets 16-25)

The Insights page holds long-range analyses over all saved history. Each is a pure, versioned calculation over eligible data (ticket 06) with its counts, dates, method version, and exclusions shown; none calls an AI service, forecasts, prescribes, or claims causes.
- **Weight phases (ticket 16, `weight-phases-v1`):** history split into Losing, Slowing, Maintaining (plateau), and Gaining phases from a 14-day rolling rate of MacroFactor's trend weight, with each phase's intake, balance, target difference, steps, protein, and weekly sets behind coverage gates.
- **Expenditure per pound (ticket 17, `expenditure-per-lb-v1`):** monthly or per-phase mean expenditure, trend weight, and kcal per lb from matched days, compared with what a constant reference ratio would imply, plus an expenditure-versus-steps association.
- **Day-of-week patterns (ticket 18, `weekday-patterns-v1`):** per-weekday intake, target difference, balance, steps, and scale-minus-trend residual, each weekday's share of above-target calories and gross surplus, and weekend vs weekdays, over the last 4 or 12 weeks or all history.
- **Over-target days (ticket 19, `food-patterns-v1`):** food-detail days classed over, within, or under target (±100 kcal), foods ranked by total and by over-minus-within calories per day, and calories by logged time with the share after 8 PM; workbook-total days are excluded and counted.
- **Protein per pound (ticket 20, `protein-per-lb-v1`):** protein in grams per lb of trend weight (food detail when present, otherwise the workbook total), its distribution and weekly series, how often your own MacroFactor protein target was met, and every missed day.
- **Strength vs body weight (ticket 21, `strength-bodyweight-v1`):** for each positive-load lift, the best-session estimated-strength score, trend weight on the session date, and score per lb, with Gained/Kept/Lost over all history, the latest 12 weeks, or a weight phase; assisted, bodyweight, and timed movements are listed, not scored.
- **Muscle balance (ticket 22, `muscle-balance-v1`):** weekly working sets per muscle from your own exercise-to-muscle mapping (MacroFactor's muscle sheet does not export the mapping behind its fractional totals, so it cannot be checked set by set), push/pull and upper/lower ratios, unmapped exercises listed, and lifts whose progress label was Stable or Declining in each of the last N comparisons (N and secondary-muscle credit are settings). The mapping is backed up; older backups restore it empty.
- **Training effort (ticket 23, `effort-v1`):** working sets by rep range (1-5, 6-10, 11-15, 16+, timed) and logged RIR (0, 1-2, 3-4, 5+, not recorded) per week and per exercise, failure sets as logged, and the weekly share of sets at RIR 0-2 charted only for weeks where at least 75% of sets have an RIR.
- **Best and worst sessions (ticket 24, `session-precursors-v1`):** each training day scored against each exercise's previous three-session median, the top and bottom thirds compared on the previous day's intake, carbohydrate, modeled balance, and steps (counts, means, medians, difference), labeled as associations with sample sizes; energy check-ins join when ticket 15 exists.
- **Notes and reviews (ticket 25, `note-compare-v1`, `review-v1`):** dated owner notes (append-only versions, private, backed up) shown as markers on the phase timeline and compared before/after with equal 14/28/56-day windows; monthly, quarterly, and yearly written reviews built from the other analyses, with explicit unavailable sections, saved as immutable reports.

## Free-tier limits and recovery (ticket 13)

- **Capacity:** before an import, report save, or restore, the app compares current usage (`capacity_status()`) plus the incoming data with the Supabase Free limits (500 MB database, 1 GB files) and stops at 90%, changing nothing. The database independently refuses any insert of new history once usage passes 95% (`FI507`, statement triggers on every history table), so a wrong browser estimate can never cause an overage or upgrade. Deletes are never blocked, so space can always be recovered.
- **Imports & Settings > Service and storage** shows usage meters with a level label, lists unfinished restore uploads (older than ten minutes) for reviewed removal (`discard_stale_restores`), and has the recovery steps.
- **Retries are safe:** imports, corrections, and undo replay by request id; report saves are idempotent by fingerprint; a restore whose response was lost is recognized when the saved history already matches the backup; stale previews are refused with `FI409`.
- **Recovery steps:** if the app cannot load or save, the Supabase Free project may be paused (after about a week without use): open the Supabase dashboard, select the project, choose Restore/Resume, wait a few minutes, and reload. If a save failed, press the same button again. If storage is nearly full, review older versions (Version retention), remove unfinished uploads, and download a backup first. If the service is unavailable, a backup cannot be downloaded; the last saved backup file is your copy. Nothing is ever upgraded or pruned automatically.
