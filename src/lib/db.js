import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  keepAlive: true
})

// Thin query helper. Deliberately NOT an ORM: for a platform whose core promise
// is "one school can never see another's data," every query touching an
// org-scoped table should show its WHERE organization_id = $1 in the code,
// not hidden behind an abstraction. See lib/scope.js for the shared helper.
export async function query(text, params) {
  return pool.query(text, params);
}