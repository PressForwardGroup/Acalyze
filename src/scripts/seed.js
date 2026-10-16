import { pool, query } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { seedDemoSchool } from './demo.js';

// First-boot seed. Creates the platform admin (you). Set these in the
// environment BEFORE first boot, and change the password after signing in:
//   PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, PLATFORM_ADMIN_NAME
// Set SEED_DEMO=true to also create a small demo school to click around in.
// Exported so autoMigrate.js can run it on first boot (Render's free plan has
// no shell). It never closes the pool; only the CLI entry below does.
export async function seed() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL || 'admin@acalyze.app').toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD || 'ChangeMe@2026';
  const name = process.env.PLATFORM_ADMIN_NAME || 'Platform Admin';
  const exists = await query(`SELECT 1 FROM platform_admins WHERE email = $1`, [email]);
  if (!exists.rows[0]) {
    await query(`INSERT INTO platform_admins (full_name, email, password_hash) VALUES ($1,$2,$3)`,
      [name, email, await hashPassword(password)]);
    console.log(`[seed] Platform admin created: ${email}`);
    if (!process.env.PLATFORM_ADMIN_PASSWORD) {
      console.warn('[seed] WARNING: using the default password. Set PLATFORM_ADMIN_PASSWORD, or change it right after signing in.');
    }
  }
  if (process.env.SEED_DEMO === 'true') await seedDemoSchool();
}

// CLI: `npm run seed`
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
