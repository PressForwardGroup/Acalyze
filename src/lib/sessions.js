import { query } from './db.js';

// "Sign out everywhere": a person can cancel every token issued before now.
// Checked on each request, with a short cache so it costs almost nothing.
const cache = new Map();
const TTL = 20_000;

async function validAfter(userId) {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.at;
  const { rows } = await query(`SELECT valid_after FROM session_resets WHERE user_id = $1`, [String(userId)]);
  const at = rows[0] ? new Date(rows[0].valid_after).getTime() : 0;
  cache.set(userId, { at, until: Date.now() + TTL });
  return at;
}

export async function revokeSessions(userId) {
  const now = new Date();
  await query(
    `INSERT INTO session_resets (user_id, valid_after) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET valid_after = EXCLUDED.valid_after`, [String(userId), now]);
  cache.set(userId, { at: now.getTime(), until: Date.now() + TTL });
}

// Token times are whole seconds, so compare in seconds: a token made in the same second as the reset
// stays valid. That is how the device that pressed the button keeps its fresh token.
export function tokenIsOlder(claims, validAfterMs) {
  return !!validAfterMs && !!claims?.iat && claims.iat < Math.floor(validAfterMs / 1000);
}

export async function sessionRevoked(claims) {
  if (!claims?.sub) return false;
  return tokenIsOlder(claims, await validAfter(claims.sub));
}
