# 14: Verify the complete mobile and cross-device release

**Status:** ready-for-agent

**What to build:** Complete the owner's weekly workflow on the hosted app: import on a phone, review on another device, correct data, regenerate findings, and recover from a failed update.

**Blocked by:** 13: Recover safely from service and quota failures.

**Acceptance criteria:**

- [ ] Demonstrate the four views, mobile upload/review, signed-in cross-device refresh, corrected reimport, undo, historical reports, and backup/restore on the assembled application.
- [ ] Verify a corrected full-history workbook without inventing unavailable historical values; confirm the known weight error is corrected or explicitly excluded.
- [ ] Verify one workout duration against MacroFactor's displayed value, retaining its configurable source-unit interpretation and raw records.
- [ ] Direct unauthorized record/archive requests fail; the public repository/build contains no private sources or privileged credentials.
- [ ] Exercise the sparse-data, high-calorie, negative-assistance, per-hand/per-side, missing-date, repeated-row, stale-write, and service-failure scenarios through relevant tests and focused end-to-end checks.
- [ ] Publish operating instructions for setup, normal weekly imports, known session grouping limitations, free-tier recovery, retention, and portability. Record actual verification outcomes and unresolved release blockers.

**External release gates:** Corrected full-history workbook and one source-app duration comparison. These do not prevent earlier tickets from using the supplied private samples and synthetic fixtures; they do prevent claiming full-source verification.
