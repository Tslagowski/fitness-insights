# Fitness Insights

A personal Vue/TypeScript/Vite workspace for nutrition and training analysis. This implementation covers ticket 01: GitHub sign-in, owner-only preference storage, responsive navigation, and honest empty states. It is live at https://tslagowski.github.io/fitness-insights/ (verified 2026-10-19). Ticket 02 adds MacroFactor workbook imports of daily history (weight, trend weight, expenditure, nutrition totals, targets, steps) with preview, atomic commit, and a private raw-file archive. Food/workout detail imports and analytics are not implemented yet.

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
- `src/import/`: workbook reading (`xlsx.ts`), CSV reading (`csv.ts`), MacroFactor daily records (`workbook.ts`), food entries (`food.ts`), multi-file import plans (`sources.ts`), and preview helpers (`preview.ts`).
- `src/components/`: the import panel, daily history table, food log, Correct a day panel, and change history with Undo.
- `supabase/migrations`: owner allowlist, row-level access rules, revisioned daily history with the atomic `commit_import` function, and the private source archive bucket.
- `tests`: UI behavior, actual database policy tests, browser transport tests.
- `tickets`: approved work and blocking dependencies; tickets 01 and 02 are done; ticket 03 is done; ticket 04 is done; ticket 05 is in progress.
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

