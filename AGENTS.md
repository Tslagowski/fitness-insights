# Fitness Insights agent instructions

Read README.md, SPEC.md, CONTRIBUTING.md, and docs/agents/issue-tracker.md before making changes.

- This is the application repository. The related Tslagowski/ideas repository holds the pitch and planning history.
- Continue the existing Vue/TypeScript/Vite implementation; do not scaffold over it.
- The owner approved the specification and 14-ticket backlog. Ticket 01 is done and live verified (Supabase Free project, GitHub OAuth, GitHub Pages). Ticket 02 (workbook daily-history import) is implemented and awaiting live verification; detailed food/workout imports and analytics remain pending.
- Follow ticket dependencies and record actual verification outcomes. Do not claim mocked transport tests prove live cloud access.
- Preserve per-hand loads and per-side reps; never add machine/base/body weight. Preserve missing data and legitimate repeated rows.
- Keep calculations reproducible and independent of paid AI. No additional recurring fees or automatic paid upgrades.
- Keep raw personal exports and privileged credentials out of Git and static builds.
- Run meaningful verification for the affected behavior. Standard commands are npm test, npm run typecheck, npm run build, and npm run test:browser after installing Playwright Chromium.
- Production hosting remains GitHub Pages plus Supabase Free. MacBook access is a development workflow, not an implicit change of hosting architecture.
