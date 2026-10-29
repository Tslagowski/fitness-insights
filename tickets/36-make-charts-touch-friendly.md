# 36: Make charts touch-friendly

**Status:** ready-for-agent

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
