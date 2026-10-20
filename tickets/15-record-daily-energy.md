# 15: Record daily energy

**Status:** deferred (owner idea, 2026-10-20; scheduled after the current backlog)

**Owner request:** A quick way to choose a date and record how I felt that day, picking from a small set of energy levels rather than typing text, so energy can later be compared with workouts, nutrition, and other daily data.

**What to build (proposed):** A one-tap energy check-in, reachable from any device, that saves one self-reported energy level per calendar date, and shows it alongside the existing daily records.

**Blocked by:** 01: Sign in and retain a private preference (done). Independent of imports, so it can be scheduled at any point.

**Proposed defaults (owner may adjust):**

- Five levels with plain labels: 1 Very low, 2 Low, 3 Okay, 4 Good, 5 Great. No free text.
- Date defaults to today (America/Denver) with a quick picker for earlier dates; one rating per date. Tapping a different level replaces it; the rating can also be cleared.
- A day without a rating is "not recorded", never a default level.
- Self-entered, so imports, reimports, and import undo never change it. Changing or clearing a rating shows when it was last updated.
- Owner-only storage enforced by the database, like all other personal data; included in the portable backup (ticket 12).
- Shown as a column in the daily history table and as a simple per-date view; future dates cannot be rated.

**Acceptance criteria (draft):**

- [ ] From a phone, rating today takes one tap after opening the check-in; rating another date takes at most three.
- [ ] One level per date; changing or clearing it is immediate and visible on another device after refresh.
- [ ] Missing ratings stay missing in every view and calculation; they are not treated as "Okay" or zero.
- [ ] Only the configured owner can read or change ratings, including through direct API requests.
- [ ] Ratings survive imports, corrections, and import undo unchanged.

**Scope decision needed (comparison with other data):** SPEC.md section 2 lists "correlations and causal explanations" as not included initially. Recording energy does not conflict with that. Comparing energy with workouts and nutrition does, so it needs the owner's explicit approval as a spec change before it is built. A descriptive option consistent with the spec's style would be a follow-up ticket that shows, for example, average energy on training days vs rest days or on surplus vs deficit days, with counts and coverage, labeled as observations and never as causes. Statistical correlation measures would be a further decision.

## Owner decisions (2026-10-20)

- The five levels (Very low, Low, Okay, Good, Great) are accepted.
- The check-in is deferred until after the current backlog.
- The comparison follow-up (and the related SPEC change) is not yet decided.
