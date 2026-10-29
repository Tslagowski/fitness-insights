# 36: Make charts touch-friendly

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#21](https://github.com/Tslagowski/fitness-insights/issues/21)

**What to build:** Let charts be read with a thumb: scrub to see values, larger labels, fewer ticks.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Dragging across a time or category chart moves a crosshair and shows a floating label with the date and values; releasing keeps the selection.
- [ ] Axis labels are at least 12px; date labels are thinned so none overlap at 390px.
- [ ] Dense charts (weekly sets, session scores) aggregate or limit the shown range on phones, with the full range available.
- [ ] Keyboard selection (arrow keys) still works.
- [ ] Phone tests drive a touch drag and check the label.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

`use-scrub.ts`: a touch or pen drag across any chart captures the pointer and selects the column under the finger continuously (daily intake and balance, weight and steps, exercise scores, every category chart); charts use `touch-action: pan-y`, so vertical swipes still scroll. Category charts show a floating label with the column's values above the plot; the weight-phase timeline keeps its date and value label after the finger lifts. Axis labels are 12px and category labels are thinned at 58px spacing. On phones, category charts longer than 26 columns (for example the 69-session score chart) start with the latest 26, with "Show all N" / "Show the latest 26". Arrow keys still move the selection. Verified: phone test drives a touch drag and checks the label, the label size, and the range toggle; browser suite; 430px screenshots.
