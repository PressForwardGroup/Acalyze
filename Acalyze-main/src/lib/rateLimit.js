// Small in-memory rate limiter for the public/sensitive endpoints (login,
// forgot-password, school registration). Per client IP, fixed window.
// In-memory is fine for a single server; if Acalyze is ever scaled to several
// instances, swap the Map for a shared store (e.g. Redis) without changing callers.
export function rateLimit({ windowMs = 60_000, max = 10, message = 'Too many attempts. Please wait a minute and try again.' } = {}) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
