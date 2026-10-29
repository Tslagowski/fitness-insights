# 33: Tuck method labels and fine print behind an info control

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#18](https://github.com/Tslagowski/fitness-insights/issues/18)

**What to build:** Keep the trust details (method versions, coverage rules, evidence) one tap away instead of on every card.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Method version pills and long method paragraphs move into an ⓘ control or the existing "How this is calculated" section on each card.
- [ ] Coverage problems that change what a number means (insufficient data, partial periods, estimates) stay visible inline.
- [ ] Every piece of evidence and method text remains reachable by keyboard and screen reader.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

`MethodInfo.vue`: every "Method …" and "Template …" pill (15 panels) is now a small ⓘ control whose popover names the method version (plus the progress band or data version where those were on the pill) and points to "How this is calculated". The intake card's period, freshness, coverage chips, and source line fold into "Data coverage: N of M days" when coverage is complete; when it is short, a visible warning states the counts and the details open. Other pills that carry status (pending count, versions kept, Today) are unchanged. Everything remains in the DOM for keyboard and screen readers. Verified: UI test of the control, existing intake coverage tests, browser suite, 430px screenshots.
