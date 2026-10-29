# 38: Make daily list rows more informative

**Status:** in-progress (implemented 2026-10-29; owner review on the phone pending)

**GitHub issue:** [#23](https://github.com/Tslagowski/fitness-insights/issues/23)

**What to build:** Show a few key numbers per day with a small bar comparing intake with target, instead of rows full of dashes.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Each daily row shows weight, intake, and steps (whatever is recorded) and a compact bar of intake vs target; missing values are omitted from the row rather than shown as "—", and still listed as not recorded when expanded.
- [ ] Status labels (excluded, pending review, incomplete, planned) stay visible.
- [ ] UI and phone tests.

**Constraints:** Primary device is an iPhone 14 Pro Max (430×932 CSS px, notch and home indicator); every change is verified at 390px and 430px with no horizontal page scroll. Presentation only: calculations, method versions, eligibility, and evidence stay exactly as they are and remain reachable. Hosting stays GitHub Pages plus Supabase Free; no new paid services or tracking.

## Implementation evidence (2026-10-29)

Daily records on phones open on a new "Day" view: intake as the primary value (scale weight when there is no intake), then only what was recorded (weight, steps, protein, "marked incomplete"), with no "—" placeholders, and a compact bar of intake against that day's target (target mark at two thirds of the bar, orange when over, capped at 150%). The Intake, Weight, and Activity views also drop missing values from the row line; expanded details still list every field, missing ones as "not recorded". Excluded and pending weigh-ins, †, Planned, In progress, and Awaiting import labels are unchanged. Verified: phone-lists test (Day view default, no dashes, meter visible), browser suite, 430px screenshot.
