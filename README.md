# Fitness Insights

A personal Vue/TypeScript/Vite workspace for nutrition and training analysis. This implementation covers ticket 01: GitHub sign-in, owner-only preference storage, responsive navigation, and honest empty states. Data imports and analytics are not implemented yet.

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

1. Create/select your Supabase Free project. Do not enable a paid plan. Run `supabase/migrations/202609150001_owner_preferences.sql` once through its SQL editor. This initially allows nobody to access app preferences.
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
- `src/supabase-gateway.ts`: OAuth and preference transport.
- `supabase/migrations`: owner allowlist and row-level access rules.
- `tests`: UI behavior, actual database policy tests, browser transport tests.
- `tickets`: approved work and blocking dependencies; ticket 01 is the active slice.
- `CONTEXT.md` and `docs/adr`: terminology and selected architecture.

Dependencies are pinned with a lockfile. TypeScript is pinned to a version compatible with the installed Vue type checker. Preferences are fetched on page load/auth changes; another device sees the new value on refresh, not via a realtime subscription.

## Primary references

- [Supabase GitHub authentication](https://supabase.com/docs/guides/auth/social-login/auth-github)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages)

Live setup requires the owner's GitHub repository, Supabase project, and OAuth configuration. The application source is published at https://github.com/Tslagowski/fitness-insights. No live app or Supabase service has been provisioned or verified by this implementation.

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
