# Fitness Insights agent instructions

Read README.md, SPEC.md, CONTRIBUTING.md, and docs/agents/issue-tracker.md before making changes.

- This is the application repository. The related Tslagowski/ideas repository holds the pitch and planning history.
- Continue the existing Vue/TypeScript/Vite implementation; do not scaffold over it.
- The owner approved the specification and 14-ticket backlog. Tickets 01 and 02 are done and live verified (Supabase Free project, GitHub OAuth, GitHub Pages, workbook import). Ticket 03 (corrections and undo) is done. Ticket 04 (food detail import) is done. Ticket 05 (workout import) is done. Ticket 06 (review and eligibility, `src/analysis/eligibility.ts`) is implemented and awaiting live verification; analysis tickets 07-10 must use its eligibility results. Ticket 07 (intake and modeled balance, `src/analysis/intake.ts`) is implemented and awaiting owner review. Ticket 08 (weight and activity, `src/analysis/trends.ts`; shared periods in `src/analysis/periods.ts`) is implemented and awaiting owner review. Ticket 09 (exercise progress, `src/analysis/exercise.ts`) is implemented and awaiting owner review. Ticket 10 (written overview, `src/analysis/report.ts`) is implemented and awaiting owner review. Ticket 11 (saved reports and version retention) is implemented and awaiting owner review. Ticket 15 (daily energy) is deferred. Database changes ship as new files in supabase/migrations applied by the Database migrations workflow.
- Follow ticket dependencies and record actual verification outcomes. Do not claim mocked transport tests prove live cloud access.
- Preserve per-hand loads and per-side reps; never add machine/base/body weight. Preserve missing data and legitimate repeated rows.
- Keep calculations reproducible and independent of paid AI. No additional recurring fees or automatic paid upgrades.
- Keep raw personal exports and privileged credentials out of Git and static builds.
- Run meaningful verification for the affected behavior. Standard commands are npm test, npm run typecheck, npm run build, and npm run test:browser after installing Playwright Chromium.
- Production hosting remains GitHub Pages plus Supabase Free. MacBook access is a development workflow, not an implicit change of hosting architecture.
