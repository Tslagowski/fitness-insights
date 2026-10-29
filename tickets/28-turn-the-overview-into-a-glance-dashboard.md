# 28: Turn the Overview into a glance dashboard

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#13](https://github.com/Tslagowski/fitness-insights/issues/13)

**What to build:** Open the app to a screen of headline tiles answering "how am I doing" without scrolling, with the written overview available below.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Above the fold at 430×932: tiles for trend weight (value and weekly rate), mean intake vs target, protein per lb, mean steps, working sets this week, and items waiting for review (only shown when there are any).
- [ ] Each tile shows its value, a short comparison with the previous period, a small sparkline of recent weeks, and its window; values come from the existing ticket 07-09 and 16-23 results, and a tile without enough data says so instead of showing a number.
- [ ] Tapping a tile opens the page or Insights topic with the detail.
- [ ] The written overview (ticket 10) stays on the page below the tiles, collapsed by default, and is still saved as reports exactly as before.
- [ ] UI and phone tests; screenshot reviewed at 430px.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

`GlanceDashboard.vue` over `src/analysis/glance.ts` (presentation only; values from `summarizeRange`, `analyzeProtein`, and the daily series' confirmed working sets). Five tiles (trend weight with rate, intake vs target, protein per lb, steps, working sets in the latest complete week) each with a comparison, a 12-week sparkline, and its window; tiles below the coverage gate show "—" and the reason. A banner links to pending weigh-in reviews. The written overview is folded below (still generated and saved as before). Arrows were dropped because they could disagree with the text beside them. Verified: unit tests (`glance.test.ts`), app UI test, phone test (`overview.spec.ts`), and a 430×932 screenshot.
