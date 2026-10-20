# 03: Correct imported history and undo changes

**Status:** ready-for-agent

**What to build:** Upload an overlapping workbook and review additions/corrections, intentionally clear a day's records, or undo the latest confirmed import without losing unrelated history.

**Blocked by:** 02: Import workbook daily history.

**Acceptance criteria:**

- [ ] Preview distinguishes added, changed, and unchanged data; confirmed replacement affects only explicitly represented dates within the relevant domain.
- [ ] Absent dates preserve saved records. Explicit day clearing has its own preview and affects only the selected domain.
- [ ] Reimporting unchanged data does not add duplicates or create an artificial changing import version.
- [ ] Every changing import preserves the prior revision; Undo last import restores the previous active records and relevant review state atomically.
- [ ] A preview based on an older revision cannot overwrite a change from another device. The user is prompted to refresh the preview.
- [ ] Retried/failed commits preserve history; the import history explains the result. The revision contract supports additional source domains without a separate correction mechanism.
