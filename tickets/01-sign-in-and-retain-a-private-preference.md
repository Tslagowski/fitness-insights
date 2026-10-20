# 01: Sign in and retain a private preference

**Status:** blocked (code complete; live account setup and hosted verification pending)

**What to build:** A minimal hosted app where the owner signs in with GitHub, changes a display preference, and sees it after refresh or on a second device. Establish only the foundation needed for this working path, including the responsive four-view navigation and empty states.

**Blocked by:** None (first implementation ticket after backlog approval).

**Acceptance criteria:**

- [ ] GitHub sign-in permits only the configured owner to read/write personal preferences. Another identity and an unauthenticated request cannot bypass the restriction through direct data access.
- [ ] A saved display preference persists across refresh and devices. Calendar defaults are America/Denver and Monday-start weeks.
- [x] Overview, Nutrition & Weight, Training, and Imports & Settings have usable navigation and truthful empty states on mobile.
- [ ] The static app loads correctly under the chosen GitHub Pages path and authentication returns to the correct app URL.
- [ ] The deployed frontend contains no privileged credentials, personal exports, or private fixture data.
- [x] Setup instructions cover the free services, owner identity, callback configuration, and ordinary typechecking/build verification. No paid option is required or automatically enabled.

**External prerequisite:** At execution time, the owner's repository/account access and Supabase/GitHub application configuration will be needed. Complete code and instructions first where access is unavailable; do not claim deployment completed without verification.

## Implementation evidence (2026-09-17)

- Seven UI/database tests passed, including direct PostgreSQL access-policy checks and failed sign-out recovery.
- Three Chromium browser tests passed with mocked Supabase transport: GitHub redirect/PKCE, mobile save and separate-browser restore, and non-owner rejection. Desktop and mobile screenshots inspected.
- Typecheck and production builds passed with both unconfigured setup mode and a configured repository subpath using public test values.
- Standards and specification reviews completed; sign-out recovery and skip-link findings fixed. See docs/ticket-01-review.md.
- Remaining acceptance gates require the owner's GitHub repository, Supabase project, OAuth configuration, and live deployment. No hosted or real multi-device success is claimed.
