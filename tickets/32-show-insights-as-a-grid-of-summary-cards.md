# 32: Show Insights as a grid of summary cards

**Status:** ready-for-agent

**GitHub issue:** [#17](https://github.com/Tslagowski/fitness-insights/issues/17)

**What to build:** Replace the wall of twelve topic buttons with cards that each show the topic's headline result.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Each Insights topic has a card with its name, one headline value or label (for example "Losing −0.97 lb/wk" or "0.68 g/lb"), and a status when data is insufficient.
- [ ] Tapping a card opens the full topic view, with a clear way back to the grid; the open topic is kept in the URL.
- [ ] Cards are grouped (Weight & energy, Nutrition, Training, Notes & reviews).
- [ ] Headline values come from the same versioned calculations as the topic views.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.
