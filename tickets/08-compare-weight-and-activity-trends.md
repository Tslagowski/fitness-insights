# 08: Compare weight and activity trends

**Status:** ready-for-agent

**What to build:** Explore scale weight, source trend weight, and steps across periods, seeing how coverage and exclusions affect the displayed changes.

**Blocked by:** 06: Review suspicious values and incomplete days.

**Acceptance criteria:**

- [ ] Show scale points and source trend values separately, with gaps rather than silently filled missing measurements.
- [ ] Weekly trend rate follows the documented elapsed-calendar-day slope formula and coverage gate. Source trend is not reconstructed from the owner's scale data.
- [ ] Steps averages use observed eligible values and show their own coverage; lack of nutrition or workout data does not erase valid standalone series.
- [ ] Seven-day, 28-day, and custom dates follow the agreed calendar and standard cutoff conventions; no chart shifts source dates because the viewing device uses another timezone.
- [ ] Individual points and comparison results link to their source dates, units, exclusions, and method. Suspect source estimates retain warnings after a scale exclusion.
- [ ] A corrected import or review decision updates active results while preserving historical revisions for later report snapshots.
