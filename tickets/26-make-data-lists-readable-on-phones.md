# 26: Make data lists readable on phones

**Status:** ready-for-agent

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
