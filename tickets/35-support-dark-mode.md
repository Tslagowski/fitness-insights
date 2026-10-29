# 35: Support dark mode

**Status:** ready-for-agent

**GitHub issue:** [#20](https://github.com/Tslagowski/fitness-insights/issues/20)

**What to build:** Follow the iPhone's light or dark appearance automatically.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Colors move to CSS custom properties with a light and a dark set, switched by prefers-color-scheme; a Settings option allows System, Light, or Dark.
- [ ] Charts, phase bands, and status colors keep at least 3:1 contrast against the dark background; text meets WCAG AA.
- [ ] The theme-color and status bar match the appearance.
- [ ] Phone screenshots reviewed in both appearances; UI tests cover the setting.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.
