import crypto from 'node:crypto';

// Encrypts keys before they are stored (AES-256-GCM). The key lives in the server setting MPESA_SECRET_KEY
// (64 hex characters), never in the database, so a copy of the database alone reveals nothing.
const keyBuf = () => { const k = process.env.MPESA_SECRET_KEY || ''; return /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, 'hex') : null; };
export const secretsReady = () => !!keyBuf();

export function encryptSecret(plain) {
  const key = keyBuf();
  if (!key) throw new Error('The server has no MPESA_SECRET_KEY, so keys cannot be stored yet.');
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(blob) {
  const key = keyBuf();
  if (!key) throw new Error('The server has no MPESA_SECRET_KEY.');
  const [v, iv, tag, enc] = String(blob || '').split(':');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Stored key is not readable.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
