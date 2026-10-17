// Email through Resend, when RESEND_API_KEY and MAIL_FROM are set. Never
// throws: if email isn't configured or fails, callers carry on and show the
// information on screen instead (so nothing depends on email working).
export function mailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendEmail(to, subject, text) {
  if (!mailConfigured() || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const appUrl = () => (process.env.APP_URL || '').replace(/\/+$/, '');
