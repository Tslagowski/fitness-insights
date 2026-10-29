# 29: Slim the page header

**Status:** ready-for-agent

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
