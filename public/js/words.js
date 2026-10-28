// An amount in words, as written on a payment voucher: 12,500 -> "Twelve thousand five hundred shillings only".
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function below1000(n) {
  const out = [];
  if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; if (n) out.push('and'); }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')); } else if (n > 0 || !out.length) out.push(ONES[n]);
  return out.join(' ');
}
export function amountWords(amount) {
  const total = Math.round(Number(amount) * 100) / 100;
  let whole = Math.floor(total + 1e-9), cents = Math.round((total - whole) * 100);
  const parts = [];
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) { if (whole >= size) { parts.push(`${below1000(Math.floor(whole / size))} ${name}`); whole %= size; } }
  if (whole > 0 || !parts.length) parts.push(below1000(whole));
  const words = parts.join(' ').replace(/^./, (c) => c.toUpperCase());
  return `${words} shillings${cents ? ` and ${below1000(cents)} cents` : ''} only`;
}
