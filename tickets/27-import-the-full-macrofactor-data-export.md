# 27: Import the full MacroFactor data export

**Status:** ready-for-agent

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
