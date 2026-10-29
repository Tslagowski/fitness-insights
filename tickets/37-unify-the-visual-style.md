# 37: Unify the visual style

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#22](https://github.com/Tslagowski/fitness-insights/issues/22)

**What to build:** Give the app one consistent look: an accent for on-target, one for watch-this, larger numbers, tighter spacing.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] A small set of tokens (colors, type scale, spacing, radii) is defined once and used everywhere; status colors are consistent across pages (for example progressing, on target, insufficient).
- [ ] Headline numbers use a larger tabular-figure style; secondary text is quieter but still AA contrast.
- [ ] Cards and lists use consistent padding and dividers.
- [ ] No change to any calculated value; screenshots before/after reviewed at 430px.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

Color roles from ticket 35 replace about 150 one-off hex values; added shared radius (card 12px, control 9px), card spacing, and small-text tokens; tabular figures for headline numbers, tiles, list values, and insight cards; consistent card radii and phone padding. No calculated value changed (all tests unchanged). Before/after screenshots at 430px reviewed.
