# Development standards

Use TypeScript and readable full names. Keep the implementation scoped to the active ticket. Components describe user workflows; the Supabase adapter owns transport details. Test visible interface behavior and actual database authorization rules, not internal call counts. Keep async auth transitions race-safe and errors honest. No privileged key, personal export, or private source fixture may enter version control. Raw load semantics in CONTEXT.md apply to later analytics tickets.

Run typechecking, relevant tests while changing a feature, and the complete suite before finishing. Each release claim must name what was actually verified; local policy tests are not proof of live OAuth or hosted cross-device behavior.
