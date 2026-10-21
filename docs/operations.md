# Operating Fitness Insights

How to set up, use week to week, and look after the app on GitHub Pages plus Supabase Free. Nothing here needs a paid service, and nothing runs on your computer except optional local development.

## 1. Setup (once)

The detailed steps are in the README sections "Connect the free services", "GitHub Pages", and "Database changes". In short:

1. Supabase Free project with GitHub sign-in; your verified user id enrolled in `private.app_owner`.
2. GitHub repository variables `VITE_BASE_PATH`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (public values), and secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` for the Database migrations workflow.
3. Database changes apply automatically when a migration file lands on `main` (Actions > Database migrations). The site deploys when you run Actions > Deploy GitHub Pages; after deploying it re-checks that anonymous requests are refused.
4. Open the site on your phone and add it to the home screen.

## 2. Weekly routine

1. In MacroFactor, export the workbook (`.xlsx`), and optionally the food CSV and the workout CSV. Exports can overlap previous ones; nothing is duplicated.
2. In the app: Imports & Settings > Import MacroFactor exports > choose the files (one, two, or all three at once).
3. Read the preview: date coverage, new / corrected / unchanged counts, any reconciliation differences between food entries and workbook totals. Confirm.
4. Overview: read the written overview. A new saved report is created automatically when anything it depends on changed. Review any flagged weigh-ins (Keep or Exclude) and mark days whose food logging you know was incomplete.
5. Nutrition & Weight and Training: pick 7 days, 28 days, or a custom range; tap a day or a session for its values and formulas.
6. Download a backup (Imports & Settings > Backup and restore) after imports you care about, and keep the file somewhere private.

Today is always "in progress" and later dates are "planned"; a day counts as complete only after an import made after that day.

## 3. Corrections

- **Re-import a corrected export:** the preview shows exactly which dates change; dates the file does not cover are untouched.
- **Clear one day's data** (Correct a day) or **Undo** the latest change (Change history). Undo can be repeated back through the latest 12 versions.
- **Review decisions** apply to the exact saved value; a corrected value is checked again automatically.
- Exercise display names (Training > Exercise names) group logged names without changing them.

## 4. Known limitations

- **Workout sessions** are identified by date, workout name, and workout duration because the export has no session id; two identical same-day sessions appear as one.
- **Durations** are raw numbers without a unit in the export. They are read as seconds by default (Imports & Settings > Workout duration values) until one session is checked against MacroFactor; raw values are always kept.
- **MacroFactor estimates** (expenditure, trend weight) are used as exported. Excluding a questioned weigh-in here does not change them; the affected dates are marked †.
- Progress labels, coverage gates, and the modeled energy balance are transparent heuristics, not statistical tests or measured fat change.

## 5. Free-tier care and recovery

Imports & Settings > Service and storage shows database and file usage against the free limits (500 MB database, 1 GB files).

- **App cannot load or save:** the Supabase Free project pauses after about a week without use. Open the Supabase dashboard, select the project, choose Restore/Resume, wait a few minutes, and reload. Nothing is lost while it is paused.
- **A save failed or the connection dropped:** press the same button again. Imports, corrections, undo, report saves, and restores recognize work that already committed and refuse to overwrite a newer change from another device.
- **Storage getting full:** the app stops imports, report saves, and restores at 90%; the database itself refuses new data at 95% but always allows cleanup. Download a backup, then use Version retention (removes only records superseded before the latest 12 versions, after a preview) and remove unfinished restore uploads.
- The app never upgrades the plan and never removes data on its own.

## 6. Retention

- Every import, correction, and undo creates a data version; identical re-imports create none.
- The latest 12 versions, their saved reports, all current records, import history, and the original export files are always kept.
- Older superseded records and reports for older versions are removed only when you confirm in Version retention. Undo then stops at the oldest kept version. A backup made before pruning still contains everything.

## 7. Portability

- **Backup:** Imports & Settings > Backup and restore > Download backup. One ZIP with a checksummed manifest, every table (including superseded history and saved reports), settings, and the original exports. No passwords, keys, or account ids.
- **Restore** (same or new installation): set up the new installation (section 1), sign in as the owner, then choose the backup file. The app checks every checksum and the free-tier capacity, shows current vs backup contents, and replaces everything in one step only after you confirm. A failed or interrupted restore changes nothing.

## 8. Checks the project runs

- `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser` (Check workflow on every push).
- `node scripts/check-public-safety.mjs` after the build (Check and Deploy): no spreadsheets, CSVs, archives, environment files, or credentials in the repository or the static site.
- `node scripts/probe-anonymous-access.mjs` after each deploy: every private table, function, and the archive bucket refuse anonymous requests on the hosted project.
