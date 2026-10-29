# 29: Slim the page header

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#14](https://github.com/Tslagowski/fitness-insights/issues/14)

**What to build:** Give content the top of the screen: one compact title bar instead of the brand bar, breadcrumb line, and repeated section label.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] On phones, a single bar shows the app mark and the page title; the "Workspace /" breadcrumb and the repeated "THE BIG PICTURE" label are removed.
- [ ] Sign out moves to Settings; owner status stays visible there.
- [ ] The bar respects the notch (safe-area insets) when the app runs full screen.
- [ ] Wide screens keep a sidebar layout without the duplicated labels.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

On phones the brand bar, breadcrumb line, and "THE BIG PICTURE" label are replaced by one sticky bar with the app mark and the page title (the h1 stays for screen readers), padded for the notch with `env(safe-area-inset-top)`. The eyebrow label is removed on wide screens too; the desktop top bar shows only the page title and account. Sign out also lives in a new Settings → Account section (the top bar keeps it on wide screens and in non-ready states such as an error). Verified with the app UI tests and 430×932 screenshots of Overview and Nutrition.
