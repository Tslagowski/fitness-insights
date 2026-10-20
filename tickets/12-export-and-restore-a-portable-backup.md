# 12: Export and restore a portable backup

**Status:** ready-for-agent

**What to build:** Download a self-contained backup and restore it through an explicit validation/preview workflow, recovering personal history and saved reports on a clean installation.

**Blocked by:** 11: Browse immutable report and import history.

**Acceptance criteria:**

- [ ] Backup includes accumulated records, settings, provenance, review/completeness state, retained versions/reports, and source material necessary to reproduce those versions, with versioned format and integrity checks.
- [ ] No credentials are included. Backup access is restricted to the owner; the downloaded contents are portable to a new owner-configured installation.
- [ ] Restore validates format/integrity and available capacity before previewing replacement. Explicit confirmation precedes the atomic state change.
- [ ] Invalid, interrupted, or stale restore attempts preserve the existing usable state. Identity-bound records are safely rebound to the configured owner, never to arbitrary IDs in an archive.
- [ ] A round-trip preserves counts, row multiplicity, exclusions, formulas/settings references, and saved report output.
