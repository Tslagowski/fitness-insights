# 31: Split long pages into tabs

**Status:** ready-for-agent

**GitHub issue:** [#16](https://github.com/Tslagowski/fitness-insights/issues/16)

**What to build:** Break Nutrition & Weight, Training, and Settings into a few tabs so each view is short.

**Blocked by:** 29: Slim the page header.

**Acceptance criteria:**

- [ ] Nutrition & Weight: Summary (intake, balance, weight and activity), Daily (daily records), Food log. Training: Progress, Log, Exercise names. Settings: per ticket 39.
- [ ] Tabs are a sticky segmented control under the title; the selected tab is kept in the URL so back/forward and reload return to it.
- [ ] Long lists start with the latest two weeks (or 20 sessions) and offer Show more.
- [ ] Existing deep links (#nutrition, #training) keep working.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.
