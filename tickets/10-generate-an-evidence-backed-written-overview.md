# 10: Generate an evidence-backed written overview

**Status:** ready-for-agent

**What to build:** Open Overview after an import and read concise descriptive findings about intake, weight/activity, and exercise changes, with links to their supporting analysis.

**Blocked by:** 07: Explain intake and modeled energy balance; 08: Compare weight and activity trends; 09: Compare exercise performance and workload.

**Acceptance criteria:**

- [ ] Templates consume the existing calculation results, not independent formulas or paid AI calls. Each supported domain can report even when another has insufficient data.
- [ ] Findings expose actual windows, eligible counts, settings, exclusions, formula/method version, and evidence records.
- [ ] Distinguish source estimates, calculated observations, and unavailable results. Do not prescribe diet/training changes or assert causal explanations/forecasts.
- [ ] Mean and median changes and high-intake contributions can be described without removing large valid days or suggesting they prove a cause.
- [ ] Import changes are separate from period changes. Corrections to old records are not described as recent behavior changes.
- [ ] A generated report records its data/settings revision and cutoff so it can be rendered reproducibly. Sparse data yields explicit unavailable sections, never fabricated findings.
