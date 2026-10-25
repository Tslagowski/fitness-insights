# 27: Import the full MacroFactor data export

**Status:** in-progress (implemented 2026-10-24; owner import on the hosted app pending)

**GitHub issue:** [#12](https://github.com/Tslagowski/fitness-insights/issues/12)

**What to build:** Import MacroFactor's full data export (the multi-sheet `.xlsx` with one sheet per measure) through the same preview, commit, correction, and undo workflow as the existing quick-export workbook, so the complete history since May 2025 can be loaded and verified.

**Blocked by:** 02: Import workbook daily history; 06: Review suspicious values and incomplete days.

**Background (owner export inspected 2026-10-22, not committed):** the file has separate sheets: Calories & Macros (Date, Calories, Fat, Carbs, Protein; includes pre-logged future days), Scale Weight (Date, Weight (lb), Fat Percent), Weight Trend, Expenditure, Steps, Nutrition Program Settings (target changes by Program Update Date and Program Weekday), Partial Logging (Date, Yes/No), Micronutrients, Body Metrics, Fasting, MacroFactor-derived exercise summaries (1-RM, 3-RM, 10-RM, volume, reps, sets, duration), Muscle Groups (sets and volume), and profile/settings sheets (including name, email, and birthday). It has no dated food entries (History is only a list of food names) and no workout sets (Workouts is empty), so the food and workout CSVs remain the source of that detail. The current importer rejects the file as "missing required columns".

**Acceptance criteria:**

- [ ] Recognize the full export by sheet names and headers (not file name) and distinguish it from the quick export; a file matching neither still fails clearly with nothing saved.
- [ ] Combine Calories & Macros, Scale Weight, Weight Trend, Expenditure, and Steps into the existing daily domains with the same values, units, and blank-is-missing rules; dates may differ per sheet and each domain keeps its own coverage. Pre-logged future days stay planned, never eaten.
- [ ] Derive each day's targets (calories, protein, fat, carbs) from Nutrition Program Settings: the most recent Program Update Date on or before the day, using that day's weekday row. Days before the first update have no target. The derivation is documented, versioned, and shown in the preview.
- [ ] Partial Logging days marked Yes are offered in the preview as suggested incomplete-nutrition marks the owner can accept or skip; nothing is marked without confirmation.
- [ ] The preview reports coverage per domain, new/corrected/unchanged counts against saved history, and how every other sheet is handled (archived only, or a later ticket). Profile, email, birthday, and settings sheets are never parsed into records, shown, or analyzed; they stay only in the private raw archive.
- [ ] Source precedence: when a date was imported from both export types, the later import replaces that date's domains as today; food and workout CSV detail is unaffected. Absent dates are untouched.
- [ ] Optional extra values (Fat Percent, body measurements, micronutrients, fasting) are either kept for a later ticket or saved as new domains with their own coverage; MacroFactor's derived exercise and muscle-group summaries are archived only and never replace logged-set analysis (SPEC FR4).
- [ ] Release gate (ticket 14): run the owner's full export through the preview, confirm the full history imports without inventing missing dates, and confirm the known 297.8 lb weigh-in is absent, corrected, or explicitly excluded.
- [ ] Synthetic fixture in the full-export layout (no personal data committed); unit, database (if a migration is needed), UI, and 390px browser tests.

## Implementation evidence (2026-10-24)

Design: `src/import/full-export.ts` recognizes the full export when no quick-export daily sheet exists and at least three per-measure sheets (including calories and macros) match by headers. Each measure sheet maps to the existing daily domain with identical column labels; alcohol and fiber join nutrition totals from the micronutrient sheet (as the quick export carries them); Fat Percent and other micronutrients are archived only so values stay comparable with the quick export. A domain gets a record only for dates its own sheet lists. Targets use `program-weekday-v1`: the latest Program Update Date on or before the day, that update's row for the day's weekday; days before the first update get none. Partial Logging "Yes" days are offered in the preview behind an unchecked box; accepted days are saved as incomplete-nutrition marks after the import commits. Profile and settings sheets (first header "Name": user profile, gym profiles, custom exercises, training programs) are labeled private and never parsed; summaries, body metrics, fasting, food library, and notes sheets are archived. No migration was needed: the same `commit_sources` workflow, preview, corrections, and undo apply.

Owner export check (local, not committed): the Oct 22 export parsed with no findings: 555 dates (Apr 20, 2025 to Oct 26, 2026, including pre-logged days), scale weight 486 dates, trend and expenditure 521, nutrition 523, targets 525 derived from 76 program updates, steps 551, and 5 Partial Logging days. Oct 19, 2026 reads 2,333 kcal, matching MacroFactor. No weigh-in above 280 lb occurs after July 2025, so the known 297.8 lb error is not in this export.

Verified locally:

- 4 parser tests (recognition and per-measure coverage with blanks kept missing and absent dates untouched; weekday target derivation across updates; partial-logging suggestions, private and archived sheets, no profile values in records; duplicate dates, unrecognized workbooks, and ambiguous sheets fail clearly).
- 2 UI tests (preview shows sheets, targets, private-sheet handling, and partial days; accepted suggestions become incomplete marks; importing over quick-export history corrects only the listed dates and measures).
- Full suite: 164 unit/UI/database tests and 14 browser tests pass; typecheck, build, and the safety check pass.

Not yet verified: importing the export on the hosted app (the owner's step; it also completes ticket 14's full-history gate).
