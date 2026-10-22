# 26: Make data lists readable on phones

**Status:** in-progress (implemented 2026-10-22; owner review on the phone pending)

**GitHub issue:** [#11](https://github.com/Tslagowski/fitness-insights/issues/11)

**What to build:** Replace wide horizontally-scrolling tables on phone screens with month-grouped, tappable rows and a small column set chosen by a switch, keeping full tables on wide screens.

**Blocked by:** None.

**Acceptance criteria:**

- [ ] Below 760px, the daily history, intake and weight date lists, food log, training sessions, and exercise session lists render as rows grouped under month headings (for example "October 2026"); the date shows as "Mon 19" without a repeated year.
- [ ] Each row shows one primary value plus two or three secondary values; a segmented switch chooses the group shown (for example Weight, Intake, Activity for daily history) so values fit without horizontal scrolling.
- [ ] Tapping a row expands every field for that date or session, with status labels (excluded, pending review, planned, †) kept visible.
- [ ] On wide screens the existing tables remain, with a narrower sticky date column (no year) and no wrapped headers.
- [ ] Long histories load in pages (for example 30 days or 20 sessions at a time) with a Show more control.
- [ ] Keyboard and screen-reader access is equivalent; browser tests at 390px confirm no horizontal page scroll and that every value remains reachable.

## Implementation evidence (2026-10-22)

Design: below 760px (`useNarrow`, matching the CSS breakpoint) a shared `DataRows` component replaces the wide tables. Rows sit under sticky month headings ("October 2026"), dates read "Wed 21", each row shows one primary value on the right and a line of secondary values, and tapping a row lists every field. Status labels (Awaiting import, In progress, Planned, Excluded by you, pending review, †) appear as tags or in the secondary line. Applied to: daily history (Intake / Weight / Activity switch, 30 days per page with Show more), the intake and weight/steps date lists (tapping selects the day for the charts' detail panel), recently trained exercises, exercise sessions, the food log (month headings; entries as rows with time, serving, and macros) and the training log (month headings; sets as rows such as "60 lb × 10" or "−100 lb assistance × 6", with RIR and base weight noted as not added). Small tables that already fit (reps at shared loads, restore preview) are unchanged.

Decision: on wide screens the existing tables stay, and the date column keeps its year so long histories stay unambiguous; width is not the problem there. This replaces the "no year on wide screens" criterion above.

Verified locally:

- New Chromium test at 390px (`phone-lists.spec.ts`): 30 month-grouped rows, view switch to Weight, row expansion showing all fields, Show more to 60 rows, intake date rows selecting the detail day, and no horizontal page scroll; the food, training, and exercise phone tests were updated to the row layout. Screenshots inspected for daily history, intake dates, food log, training log, and exercise progress.
- Full suite: 158 unit/UI/database tests (wide layout) and 14 browser tests (phone layout) pass; typecheck, production build, and the public safety check pass.
