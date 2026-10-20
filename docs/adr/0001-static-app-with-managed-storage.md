# ADR 0001: Static application with managed private storage

Status: Accepted during discovery, round 4. Implementation not yet authorized.

## Context

One owner needs weekly in-app uploads and synchronized access from phone and computers. There must be no additional recurring costs, paid model calls, or purchased domain. Maintenance should be minimal. Occasional manual recovery and hard free-tier limits are acceptable.

## Decision

Use Vue, TypeScript, and Vite for a static frontend hosted on GitHub Pages. Execute reproducible calculations in the browser. Use Supabase Free for GitHub authentication and private shared storage, with access restricted to the owner's identity. Frontend code may be public; source exports and privileged credentials must remain private.

## Alternatives considered

- Browser storage alone: simple and inexpensive, but does not provide shared cross-device state.
- Public static data snapshots: simple runtime, but introduces public data and a publishing step that does not match the chosen upload experience.
- A home server: increases operational maintenance and availability responsibilities.
- Nuxt static generation: viable, but the owner accepted Vue with Vite for this project.

## Consequences

The frontend and storage service can be deployed independently. No paid AI dependency is present. Access rules must be enforced by storage/authentication, not by hidden UI controls. Free-service limits and inactivity can interrupt operation; recovery and portable backups must be documented. No automatic paid upgrade is allowed. Calculations must remain separately testable and their versions must be recorded with saved reports.

Exact schema, quota enforcement, import transaction strategy, and calculation definitions remain specification work. This ADR records the selected architecture rather than claiming services have been provisioned.
