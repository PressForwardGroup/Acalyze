-- DEVELOPMENT ONLY. Wipes EVERYTHING in the database (all schools, marks, accounts).
-- Run it, then restart the app: it rebuilds the schema and your platform admin on boot.
--   psql "$DATABASE_URL" -f db/reset.sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
