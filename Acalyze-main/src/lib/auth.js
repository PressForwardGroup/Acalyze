import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set — refusing to start with an insecure default.');

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Every token embeds organizationId — the single fact every downstream
// query relies on to scope data (centerId further scopes within that org,
// but is never the auth boundary on its own). role is one of:
// platform_admin | admin | teacher | parent.
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
