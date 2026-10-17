# Migrations

`db/schema.sql` is version 1 (the baseline). Every later change to the database goes here as a numbered file:

    db/migrations/002_add_something.sql
    db/migrations/003_another_change.sql

On boot, Acalyze applies any file it hasn't applied yet, in order, each inside a transaction (a failing migration changes nothing).
Which ones have run is recorded in the `schema_migrations` table.

Rules:
- Never edit a migration after it has been deployed. Add a new one instead.
- Keep each migration safe on live data (add columns as nullable or with a default; don't drop things in use).
- When you add a migration, also update `db/schema.sql` so a brand-new database ends up identical.
