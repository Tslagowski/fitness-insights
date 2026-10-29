# 31: Split long pages into tabs

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

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

## Implementation evidence (2026-10-29)

`PageTabs.vue`: a sticky segmented control of links; routes are `#page/view` (for example `#nutrition/daily`), read by `readRoute` in App.vue, so back, forward, and reload keep the view and `#nutrition` / `#training` still work (first tab). Nutrition & Weight: Summary / Daily / Food log (with an empty state when no food detail exists). Training: Progress / Log; the exercise-name aliases stay inside the Log, where they are used, so no third tab. Daily records and the food log now page by 14 days on phones; the training log already pages by 20 days. Generic `nav` styles were scoped to the sidebar so page tabs render as one row. Verified: `tests/browser/tabs.spec.ts` (URL, reload, back, Settings sections, no horizontal scroll), updated UI and browser tests, 430px screenshots.
