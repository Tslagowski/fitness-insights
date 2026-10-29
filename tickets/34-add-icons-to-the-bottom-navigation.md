# 34: Add icons to the bottom navigation

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#19](https://github.com/Tslagowski/fitness-insights/issues/19)

**What to build:** Make the five tabs easier to hit and scan with icons above their labels.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Inline SVG icons (no icon font or external CDN) for Overview, Nutrition, Training, Insights, Settings, with the label below.
- [ ] The current tab is clearly marked; touch targets are at least 44×44 pt; the bar sits above the home indicator.
- [ ] Haptic feedback is not available to web pages on iOS Safari, so no fake vibration is added.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

Inline SVG line icons (no font or CDN) for the five tabs; on phones the icon sits above the label, the current tab's icon gets a filled pill, and each tab is at least 52px tall above the home indicator. The sidebar on wide screens shows the same icons in place of the 01-05 numbers. Haptics are not available to web pages on iOS, so none are faked. Verified: install test checks the inline icons, browser suite passes, 430px screenshot of the tab bar.
