# 38: Make daily list rows more informative

**Status:** ready-for-agent

**GitHub issue:** [#23](https://github.com/Tslagowski/fitness-insights/issues/23)

**What to build:** Show a few key numbers per day with a small bar comparing intake with target, instead of rows full of dashes.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Each daily row shows weight, intake, and steps (whatever is recorded) and a compact bar of intake vs target; missing values are omitted from the row rather than shown as "—", and still listed as not recorded when expanded.
- [ ] Status labels (excluded, pending review, incomplete, planned) stay visible.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.
