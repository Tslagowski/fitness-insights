# 11: Browse immutable report and import history

**Status:** ready-for-agent

**What to build:** Browse prior imports and written reports, compare an old report with the current one, and retain recent recovery versions while preserving accumulated history.

**Blocked by:** 10: Generate an evidence-backed written overview.

**Acceptance criteria:**

- [ ] Reports capture the exact data revision, calculation/settings versions, date cutoff, and review/completeness decisions used.
- [ ] A later correction, alias, duration-unit setting, or scoring change does not silently rewrite saved reports. Recalculation creates a distinct report.
- [ ] Keep the latest 12 changing import versions and associated reports; unchanged uploads do not consume artificial version slots.
- [ ] Pruning older versions preserves accumulated normalized nutrition/workout/measurement history and provenance needed by retained reports and undo.
- [ ] A retained report remains reproducible after pruning. Changes in report inputs are clearly distinguished from changes in owner behavior.
- [ ] If capacity cannot support required retention, preserve current data and fail clearly rather than secretly discard recent versions or add charges.
