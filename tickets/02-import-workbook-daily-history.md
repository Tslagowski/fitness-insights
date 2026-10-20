# 02: Import workbook daily history

**Status:** ready-for-agent

**What to build:** From Imports & Settings, select a workbook, preview daily date coverage and values, confirm it, then browse the imported history from another device. This slice handles daily measurements, targets, expenditure, nutrition totals, and steps; detailed food/workout rows are added later.

**Blocked by:** 01: Sign in and retain a private preference.

**Acceptance criteria:**

- [ ] Detect the workbook schema by sheet/header structure rather than filename. Unsupported or malformed files produce an actionable error without changing saved history.
- [ ] Preserve original dates, units, missing values, raw source archive, and domain provenance. Missing numeric data is not zero.
- [ ] Preview shows represented dates and records; confirming creates an atomic data revision with a private source archive. Partial staging is never visible as committed history.
- [ ] Repeat submission of the identical effective import is harmless; a timeout followed by retry cannot create a duplicate committed batch.
- [ ] Saved daily records and per-domain freshness are available after refresh and on another device. Nutrition totals are provisional workbook-sourced totals until detailed imports exist.
- [ ] Owner access applies to raw archives and records. Unsupported or failed imports preserve the previous revision and report an honest failure.

**Verification evidence:** The current workbook has 30 daily rows. A full-history workbook must later be inspected; its absence does not block this sample-based slice. Do not present the 30-day sample as full-history daily coverage.
