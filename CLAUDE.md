# Instructions for AI assistants working on this repo

1. Read `PROJECT_CONTEXT.md` first — it is the source of truth for goals, UX rules, architecture and decisions.
2. After **every** change, update `PROJECT_CONTEXT.md` in the same commit: add a row to the change log and adjust any
   section the change affects (schema, routes, decisions, backlog).
3. Keep the UX rules: Arabic RTL, simple Levantine wording, status = color + icon + label, 48px touch targets,
   1-tap payment, 1-click new month, residents never log in.
4. Verify with `pnpm build` (strict TypeScript + strict templates) before committing.
5. Schema changes go in a NEW migration file (`supabase/migrations/00N_*.sql`); never edit an applied migration.
