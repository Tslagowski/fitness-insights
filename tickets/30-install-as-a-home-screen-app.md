# 30: Install as a home-screen app

**Status:** ready-for-agent

**GitHub issue:** [#15](https://github.com/Tslagowski/fitness-insights/issues/15)

**What to build:** Let the app be added to the iPhone home screen and open full screen with its own icon, like a native app.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] A web app manifest (name, short name, theme and background colors, standalone display) and icons (180px Apple touch icon, 192px and 512px, maskable) are published with the site.
- [ ] iOS meta tags: apple-mobile-web-app-capable, status-bar style, title; viewport-fit=cover with safe-area padding for the header and bottom navigation.
- [ ] Sign-in (GitHub OAuth redirect) still returns to the installed app or Safari correctly; documented in README with how to add to home screen.
- [ ] No service worker caching of private data (data stays fetched live from Supabase).
- [ ] Tests confirm the manifest and icons are built and referenced; the public safety check still passes.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.
