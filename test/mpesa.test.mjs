import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, secretsReady } from '../src/lib/secrets.js';
import { normalizePhone, stkPassword, stkTimestamp, parseStkCallback, parseC2B, createDarajaClient, darajaBase } from '../src/lib/daraja.js';
import { normalizeRef, tokenMatches, hookUrls, newHookToken } from '../src/lib/mpesa.js';

test('secrets: stored keys round-trip, differ every time, and tampering is detected', () => {
  process.env.MPESA_SECRET_KEY = 'a'.repeat(64);
  assert.ok(secretsReady());
  const a = encryptSecret('my-consumer-secret'), b = encryptSecret('my-consumer-secret');
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), 'my-consumer-secret');
  assert.ok(!a.includes('my-consumer-secret'));
  const parts = a.split(':'); parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptSecret(parts.join(':')));
  process.env.MPESA_SECRET_KEY = 'short';
  assert.equal(secretsReady(), false);
  assert.throws(() => encryptSecret('x'));
  process.env.MPESA_SECRET_KEY = 'a'.repeat(64);
});

test('phone numbers: every common way of writing a Safaricom number becomes 2547...', () => {
  for (const v of ['0712345678', '712345678', '+254712345678', '254 712 345 678', '0712-345-678']) assert.equal(normalizePhone(v), '254712345678', v);
  assert.equal(normalizePhone('0112345678'), '254112345678');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('0212345678'), null);
  assert.equal(normalizePhone(''), null);
});

test('daraja: timestamp and password are built the way Safaricom expects', () => {
  assert.equal(stkTimestamp(new Date('2026-10-20T09:30:15Z')), '20261020123015');           // Nairobi is UTC+3
  assert.equal(stkPassword('174379', 'PASS', '20261020123015'), Buffer.from('174379PASS20261020123015').toString('base64'));
  assert.equal(darajaBase('production'), 'https://api.safaricom.co.ke');
  assert.equal(darajaBase('anything else'), 'https://sandbox.safaricom.co.ke');
});

test('daraja: a successful payment prompt reply is read correctly, and a cancelled one too', () => {
  const ok = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: 'm1', CheckoutRequestID: 'ws_CO_1', ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 1500 }, { Name: 'MpesaReceiptNumber', Value: 'QGH7ABC123' }, { Name: 'PhoneNumber', Value: 254712345678 }] } } } });
  assert.deepEqual([ok.checkoutRequestId, ok.resultCode, ok.amount, ok.receipt, ok.phone], ['ws_CO_1', 0, 1500, 'QGH7ABC123', '254712345678']);
  const no = parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_2', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } });
  assert.deepEqual([no.resultCode, no.receipt, no.amount], [1032, null, null]);
  assert.equal(parseStkCallback({}), null);
});

test('daraja: a direct Paybill payment is read correctly', () => {
  const c = parseC2B({ TransID: 'qgh7abc123', TransAmount: '2500.00', BillRefNumber: ' RVS-001 ', MSISDN: '254700000000', FirstName: 'JANE', LastName: 'DOE' });
  assert.deepEqual([c.transId, c.amount, c.account, c.name], ['QGH7ABC123', 2500, 'RVS-001', 'JANE DOE']);
  assert.equal(parseC2B({}), null);
});

test('matching: an admission number typed in different ways is the same number', () => {
  for (const v of ['RVS-001', 'rvs 001', 'rvs001', ' Rvs-001 ']) assert.equal(normalizeRef(v), 'RVS001');
  assert.equal(normalizeRef(''), '');
});

test('callback security: only the exact secret is accepted, and the address avoids words Safaricom rejects', () => {
  const t = newHookToken();
  assert.match(t, /^[0-9a-f]{48}$/);
  assert.ok(tokenMatches(t, t));
  assert.ok(!tokenMatches(t, t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')));
  assert.ok(!tokenMatches('', ''));
  assert.ok(!tokenMatches(t, t + 'x'));
  process.env.APP_URL = 'https://acalyze.example.com/';
  const u = hookUrls('11111111-1111-1111-1111-111111111111', t);
  assert.equal(u.confirm, `https://acalyze.example.com/pay-hooks/11111111-1111-1111-1111-111111111111/${t}/confirm`);
  assert.ok(!/mpesa|safaricom/i.test(u.stk));
  delete process.env.APP_URL;
  assert.equal(hookUrls('x', t), null);
});

test('client: asks for a token with the keys, then sends the payment prompt with the right fields', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/oauth/')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: '3599' }) };
    return { ok: true, status: 200, json: async () => ({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_9' }) };
  };
  const client = createDarajaClient({ env: 'sandbox', shortcode: '174379', consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' }, fakeFetch);
  const r = await client.stkPush({ amount: 1500.4, phone: '254712345678', accountRef: 'RVS-001-LONGER-THAN-12', desc: 'School fees and more', callbackUrl: 'https://x/pay-hooks/o/t/stk' });
  assert.equal(r.CheckoutRequestID, 'ws_CO_9');
  assert.equal(calls[0].opts.headers.Authorization, `Basic ${Buffer.from('ck:cs').toString('base64')}`);
  const body = JSON.parse(calls[1].opts.body);
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer tok');
  assert.deepEqual([body.BusinessShortCode, body.Amount, body.PartyA, body.PartyB, body.TransactionType], ['174379', 1500, '254712345678', '174379', 'CustomerPayBillOnline']);
  assert.equal(body.AccountReference.length, 12);
  assert.ok(body.TransactionDesc.length <= 13);
  await client.stkQuery('ws_CO_9');
  assert.equal(calls.filter((c) => c.url.includes('/oauth/')).length, 1);   // the token is reused
});

test('client: wrong keys give a plain message', async () => {
  const client = createDarajaClient({ env: 'sandbox', shortcode: '1', consumerKey: 'x', consumerSecret: 'y', passkey: 'z' }, async () => ({ ok: false, status: 400, json: async () => ({}) }));
  await assert.rejects(client.token(), /did not accept the consumer key/);
});
