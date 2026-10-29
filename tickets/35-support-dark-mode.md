# 35: Support dark mode

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#20](https://github.com/Tslagowski/fitness-insights/issues/20)

**What to build:** Follow the iPhone's light or dark appearance automatically.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Colors move to CSS custom properties with a light and a dark set, switched by prefers-color-scheme; a Settings option allows System, Light, or Dark.
- [ ] Charts, phase bands, and status colors keep at least 3:1 contrast against the dark background; text meets WCAG AA.
- [ ] The theme-color and status bar match the appearance.
- [ ] Phone screenshots reviewed in both appearances; UI tests cover the setting.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

Every literal color in `src/style.css` outside the always-dark sidebar and tab bar was mapped to a role token (surfaces, borders, text levels, brand, warning, success), defined once on `:root` with a dark set applied under `prefers-color-scheme: dark` and by an explicit choice (`data-theme`). Chart series and grid colors have dark values; phase bands are quieter in dark. Settings → Preferences → Appearance offers System, Light, or Dark, kept on this device (`src/theme.ts`, applied before first paint in `main.ts`). The status bar and theme color are the dark green bar in both modes, so they need no switch. Verified: `tests/theme.test.ts` (setting and that every color role has a dark value), browser suite, and 430px screenshots in both appearances.
