# 01: Sign in and retain a private preference

**Status:** done (live verification 2026-10-19; one optional live check not performed, see below)

**What to build:** A minimal hosted app where the owner signs in with GitHub, changes a display preference, and sees it after refresh or on a second device. Establish only the foundation needed for this working path, including the responsive four-view navigation and empty states.

**Blocked by:** None (first implementation ticket after backlog approval).

**Acceptance criteria:**

- [x] GitHub sign-in permits only the configured owner to read/write personal preferences. Another identity and an unauthenticated request cannot bypass the restriction through direct data access.
- [x] A saved display preference persists across refresh and devices. Calendar defaults are America/Denver and Monday-start weeks.
- [x] Overview, Nutrition & Weight, Training, and Imports & Settings have usable navigation and truthful empty states on mobile.
- [x] The static app loads correctly under the chosen GitHub Pages path and authentication returns to the correct app URL.
- [x] The deployed frontend contains no privileged credentials, personal exports, or private fixture data.
- [x] Setup instructions cover the free services, owner identity, callback configuration, and ordinary typechecking/build verification. No paid option is required or automatically enabled.

**External prerequisite:** At execution time, the owner's repository/account access and Supabase/GitHub application configuration will be needed. Complete code and instructions first where access is unavailable; do not claim deployment completed without verification.

## Implementation evidence (2026-09-17)

- Seven UI/database tests passed, including direct PostgreSQL access-policy checks and failed sign-out recovery.
- Three Chromium browser tests passed with mocked Supabase transport: GitHub redirect/PKCE, mobile save and separate-browser restore, and non-owner rejection. Desktop and mobile screenshots inspected.
- Typecheck and production builds passed with both unconfigured setup mode and a configured repository subpath using public test values.
- Standards and specification reviews completed; sign-out recovery and skip-link findings fixed. See docs/ticket-01-review.md.
- Remaining acceptance gates require the owner's GitHub repository, Supabase project, OAuth configuration, and live deployment. No hosted or real multi-device success is claimed.

## Live verification (2026-10-19)

Services: Supabase Free project `lrcllosfpyfwiwgjbsso` (us-west-2), GitHub OAuth app, GitHub Pages at https://tslagowski.github.io/fitness-insights/. No paid plan or add-on enabled.

- Migration applied through the Supabase SQL editor (the editor's offer to enable RLS on `private.app_owner` was accepted; harmless, since the table is unexposed and owner-privileged functions bypass it).
- Owner enrolled by GitHub provider identity (`Tslagowski`) after first sign-in; before enrollment the app showed the access-denied screen as designed.
- Unauthenticated direct API requests are refused: `preferences` select and `is_app_owner` RPC return `42501 permission denied`; without an API key the REST endpoint returns 401.
- Owner signed in on the MacBook (localhost dev server) and on an iPhone (Tailscale Serve HTTPS dev URL and the deployed Pages URL); a density change saved on one device appeared on the other after refresh. Owner-reported.
- `Deploy GitHub Pages` workflow run 39359482287 passed (tests, build, deploy). Sign-in returned to the `/fitness-insights/` root. Owner-reported.
- Deployed bundle inspected: contains only the project URL and `sb_publishable_` key; the only `sb_secret_` text is supabase-js's key-prefix check.

Not performed live: sign-in by a second, non-owner GitHub account. Non-owner rejection is enforced by the database policies (verified by the embedded-PostgreSQL policy test and the mocked browser test), and it does not depend on which identity attempts access. Run this check whenever another account is available.

Dev access note: Supabase's edge firewall rejects OAuth `redirect_to` values that are bare IP addresses (HTTP 403 "you have been blocked"). Use a hostname such as the Tailscale Serve `https://<host>.<tailnet>.ts.net/` address and add it to Supabase redirect URLs.
