# 39: Organize Settings into sections

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#24](https://github.com/Tslagowski/fitness-insights/issues/24)

**What to build:** Split the long Settings page into Import, Data & backups, and Preferences.

**Blocked by:** 31: Split long pages into tabs.

**Acceptance criteria:**

- [ ] Import: choose files and import preview. Data & backups: saved history, change history and undo, correct a day, version retention, backup and restore, service and storage. Preferences: display, analysis settings, appearance, reporting calendar, account and sign out.
- [ ] Sections use the tab pattern from ticket 31 and keep their URLs.
- [ ] Every existing setting and action remains available.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

Built with ticket 31's tabs: Import (choose files, preview, saved history), Data & backups (correct a day, change history and undo, version retention, backup and restore, service and storage), Preferences (display, analysis settings, account and sign out, reporting calendar), at `#settings/import`, `#settings/data`, `#settings/preferences`. Every existing setting and action is unchanged; appearance (ticket 35) joins Preferences. Verified by the updated UI tests and `tests/browser/tabs.spec.ts`.
