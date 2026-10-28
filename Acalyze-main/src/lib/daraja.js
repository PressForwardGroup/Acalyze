// Safaricom Daraja (M-Pesa) helpers: building requests, reading Safaricom's messages, and a small client.
// Pure functions are tested; the client takes `fetch` so it can be tested without the network.
export const darajaBase = (env) => (env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

const p2 = (n) => String(n).padStart(2, '0');
// Daraja's timestamp: YYYYMMDDHHmmss (Nairobi time)
export function stkTimestamp(d = new Date()) {
  const e = new Date(d.getTime() + 3 * 3600_000);
  return `${e.getUTCFullYear()}${p2(e.getUTCMonth() + 1)}${p2(e.getUTCDate())}${p2(e.getUTCHours())}${p2(e.getUTCMinutes())}${p2(e.getUTCSeconds())}`;
}
export const stkPassword = (shortcode, passkey, ts) => Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');

// 0712345678, 712345678, +254712345678, 254 712 345 678 -> 254712345678 (or null if it is not a Kenyan mobile number)
export function normalizePhone(v) {
  let n = String(v || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (/^0[17]\d{8}$/.test(n)) n = `254${n.slice(1)}`; else if (/^[17]\d{8}$/.test(n)) n = `254${n}`;
  return /^254[17]\d{8}$/.test(n) ? n : null;
}

// What Safaricom sends to us after a customer answers the payment prompt.
export function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return null;
  const items = Object.fromEntries((cb.CallbackMetadata?.Item || []).map((i) => [i.Name, i.Value]));
  return {
    checkoutRequestId: String(cb.CheckoutRequestID), resultCode: Number(cb.ResultCode), resultDesc: String(cb.ResultDesc || ''),
    amount: items.Amount != null ? Number(items.Amount) : null, receipt: items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber) : null,
    phone: items.PhoneNumber != null ? String(items.PhoneNumber) : null,
  };
}

// What Safaricom sends when someone pays the Paybill directly.
export function parseC2B(body) {
  if (!body?.TransID) return null;
  return {
    transId: String(body.TransID).trim().toUpperCase(), amount: Number(body.TransAmount), account: String(body.BillRefNumber ?? '').trim(),
    phone: String(body.MSISDN ?? ''), name: [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(' '),
  };
}

export function createDarajaClient(cfg, fetchImpl = fetch) {
  const base = darajaBase(cfg.env);
  let tok = null;
  async function token() {
    if (tok && tok.until > Date.now()) return tok.v;
    const r = await fetchImpl(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64')}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(r.status === 400 || r.status === 401 ? 'Safaricom did not accept the consumer key and secret.' : `Safaricom could not be reached (${r.status}).`);
    tok = { v: j.access_token, until: Date.now() + Math.max(60, Number(j.expires_in) || 3000) * 1000 - 60_000 };
    return tok.v;
  }
  async function post(path, body) {
    const r = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.errorMessage || j.ResponseDescription || `Safaricom refused the request (${r.status}).`);
    return j;
  }
  return {
    token,
    stkPush({ amount, phone, accountRef, desc, callbackUrl }) {
      const ts = stkTimestamp();
      return post('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: cfg.shortcode, Password: stkPassword(cfg.shortcode, cfg.passkey, ts), Timestamp: ts, TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount), PartyA: phone, PartyB: cfg.shortcode, PhoneNumber: phone, CallBackURL: callbackUrl,
        AccountReference: String(accountRef).slice(0, 12), TransactionDesc: String(desc).slice(0, 13),
      });
    },
    stkQuery(checkoutRequestId) {
      const ts = stkTimestamp();
      return post('/mpesa/stkpushquery/v1/query', { BusinessShortCode: cfg.shortcode, Password: stkPassword(cfg.shortcode, cfg.passkey, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId });
    },
    registerUrls({ confirmationUrl, validationUrl }) {
      return post('/mpesa/c2b/v1/registerurl', { ShortCode: cfg.shortcode, ResponseType: 'Completed', ConfirmationURL: confirmationUrl, ValidationURL: validationUrl });
    },
  };
}
