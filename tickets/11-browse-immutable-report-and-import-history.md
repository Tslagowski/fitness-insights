# 11: Browse immutable report and import history

**Status:** in-progress (deployed 2026-10-21: migration run 39534003924, Check 39534003695, Deploy 39534136852; anonymous `save_report`, `prune_history`, and `reports` refused with 42501; owner review pending)

**What to build:** Browse prior imports and written reports, compare an old report with the current one, and retain recent recovery versions while preserving accumulated history.

**Blocked by:** 10: Generate an evidence-backed written overview.

**Acceptance criteria:**

- [ ] Reports capture the exact data revision, calculation/settings versions, date cutoff, and review/completeness decisions used.
- [ ] A later correction, alias, duration-unit setting, or scoring change does not silently rewrite saved reports. Recalculation creates a distinct report.
- [ ] Keep the latest 12 changing import versions and associated reports; unchanged uploads do not consume artificial version slots.
- [ ] Pruning older versions preserves accumulated normalized nutrition/workout/measurement history and provenance needed by retained reports and undo.
- [ ] A retained report remains reproducible after pruning. Changes in report inputs are clearly distinguished from changes in owner behavior.
- [ ] If capacity cannot support required retention, preserve current data and fail clearly rather than secretly discard recent versions or add charges.

## Implementation evidence (2026-10-21)

Design: migration `202610210002_reports_and_retention.sql` adds `reports` (owner read-only via RLS; no insert, update, or delete grants), `save_report` (owner-only, active-revision check, size limit, idempotent by fingerprint), `prune_history` (owner-only dry run or apply; keeps at least 12 revisions; deletes only rows retired before the oldest kept revision and reports tied to older revisions; records `workspace_state.retained_from_revision_id`), and recreates `undo_last_change` with a guard (`FI410`) so undo never needs a pruned snapshot. Reports store full content and inputs (ticket 10), so they render identically after pruning or later changes; the fingerprint (`reportFingerprint`) covers content and inputs except the viewing date. `compareReports` lists input changes (imports and corrections between data versions, period end, band, duration unit, methods, review decisions, aliases) separately from changed findings. The Overview saves reports automatically and lists/opens/compares them; Imports & Settings has an owner-reviewed retention preview and confirm. Import history remains in Change history. Unchanged imports create no revision, so they use no retention slot.

Verified locally:

- 2 database tests: one save per fingerprint, stale revision refused, stranger and anonymous denied, no client insert/update/delete; with 14 versions the preview reports what would go, fewer than 12 kept is refused, a stale apply is refused, applying keeps active records identical and reports from the oldest kept version on, undo then walks back exactly 12 changes before refusing, and the boundary never moves backward.
- 5 UI tests (single save and no duplicate on revisit; a correction creates a distinct report, the old one is unchanged, and the comparison separates input changes from findings; a band change produces a new report named in the comparison; a failed save is reported honestly; retention preview then apply keeps active data).
- 1 Chromium test at 390px (written overview with evidence, save, open, compare, no horizontal overflow); screenshots inspected.
- Full suite: 138 unit/UI/database tests and 10 browser tests pass; typecheck and production build pass (exit codes checked).

Capacity checks before saving are ticket 13. Not yet verified: owner review on the hosted app.
