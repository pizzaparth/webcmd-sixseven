// Razorpay integration for the details + payment page and the WhatsApp
// bot. Plain fetch against the Razorpay REST API (Basic auth with
// key_id:key_secret); the browser side uses Razorpay's hosted Checkout
// (checkout.razorpay.com/v1/checkout.js), so card/UPI details are entered
// in Razorpay's own modal and never touch this server or our page.
//
// Runs in whatever mode the keys are: `rzp_test_…` keys = Test Mode (free,
// fake money, test cards like 4111 1111 1111 1111 / UPI success@razorpay),
// `rzp_live_…` = real money. The pages show a "TEST MODE" badge for the
// former. With no keys configured the site falls back to the plan's dummy
// widget — see PAYMENTS.md.

import crypto from 'node:crypto';

const env = (k) => (process.env[k] || '').trim();
const API = 'https://api.razorpay.com/v1';

export function razorpayConfig() {
  const keyId = env('RAZORPAY_KEY_ID');
  const secret = env('RAZORPAY_KEY_SECRET');
  return {
    enabled: Boolean(keyId && secret),
    keyId: keyId || null,
    test: keyId.startsWith('rzp_test_'),
    webhookSecret: Boolean(env('RAZORPAY_WEBHOOK_SECRET')),
  };
}

function authHeader() {
  return `Basic ${Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64')}`;
}

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Razorpay ${method} ${route} failed: HTTP ${res.status} ${data?.error?.description || JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

/** Rupees -> paise (Razorpay amounts are integers in the smallest unit). */
export const toPaise = (rupees) => Math.max(100, Math.round(Number(rupees) * 100));

/**
 * Creates an Order. The Checkout modal is opened against this order id and
 * the resulting payment is tied to it, which is what makes the signature
 * verification below possible.
 */
export async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  return api('POST', '/orders', { amount: toPaise(amount), currency, receipt: String(receipt).slice(0, 40), notes });
}

/** Verifies the signature Checkout returns after a successful payment. */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', env('RAZORPAY_KEY_SECRET')).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Verifies the signature on a Payment Link callback redirect. */
export function verifyPaymentLinkSignature({ linkId, referenceId, status, paymentId, signature }) {
  if (!linkId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', env('RAZORPAY_KEY_SECRET'))
    .update(`${linkId}|${referenceId || ''}|${status || ''}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

/** Verifies X-Razorpay-Signature on a webhook delivery (HMAC of the raw body with the webhook secret). */
export function verifyWebhookSignature(rawBody, header) {
  const secret = env('RAZORPAY_WEBHOOK_SECRET');
  if (!secret || !header) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, header);
}

function safeEqualHex(expectedHex, givenHex) {
  if (typeof givenHex !== 'string' || givenHex.length !== expectedHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(givenHex, 'hex'));
  } catch {
    return false;
  }
}

/** Fetches a payment so the confirmation can show method / last4 / vpa (never the full instrument). */
export async function fetchPayment(paymentId) {
  return api('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

/** Captures an authorized payment (needed when auto-capture is off in the dashboard). */
export async function capturePayment(paymentId, amountPaise, currency = 'INR') {
  return api('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency });
}

/**
 * Creates a Payment Link — a hosted Razorpay page the WhatsApp user opens
 * on their phone. `referenceId` is echoed back on the callback and webhook
 * so we can map the payment to the chat session.
 */
export async function createPaymentLink({ amount, currency = 'INR', description, customer = {}, referenceId, callbackUrl, notes = {} }) {
  return api('POST', '/payment_links', {
    amount: toPaise(amount),
    currency,
    accept_partial: false,
    description: String(description).slice(0, 2048),
    customer,
    notify: { sms: false, email: false },
    reminder_enable: false,
    reference_id: String(referenceId).slice(0, 40),
    notes,
    ...(callbackUrl ? { callback_url: callbackUrl, callback_method: 'get' } : {}),
  });
}

/** Fetches a Payment Link (status: created | paid | cancelled | expired; payments[] when paid). */
export async function fetchPaymentLink(linkId) {
  return api('GET', `/payment_links/${encodeURIComponent(linkId)}`);
}

/** Human label for a payment's method, safe to show/store: "Card · Visa ····1111", "UPI · succ…@razorpay". */
export function describePayment(payment) {
  if (!payment) return 'Razorpay';
  switch (payment.method) {
    case 'card':
      return `Card${payment.card?.network ? ` · ${payment.card.network}` : ''}${payment.card?.last4 ? ` ····${payment.card.last4}` : ''}`;
    case 'upi':
      return `UPI${payment.vpa ? ` · ${maskVpa(payment.vpa)}` : ''}`;
    case 'netbanking':
      return `Netbanking${payment.bank ? ` · ${payment.bank}` : ''}`;
    case 'wallet':
      return `Wallet${payment.wallet ? ` · ${payment.wallet}` : ''}`;
    default:
      return payment.method ? payment.method[0].toUpperCase() + payment.method.slice(1) : 'Razorpay';
  }
}

function maskVpa(vpa) {
  const [user, host] = String(vpa).split('@');
  if (!host) return vpa;
  return `${user.slice(0, 2)}…@${host}`;
}

/** Builds the confirmation record the pages/summary/WhatsApp show. No card data beyond network/last4. */
export function buildConfirmation({ payment, orderId, amount, currency = 'INR', details = {}, picks = {}, via = 'Razorpay Checkout' }) {
  const cfg = razorpayConfig();
  return {
    provider: 'razorpay',
    test: cfg.test,
    dummy: false,
    paymentId: payment?.id || null,
    orderId: orderId || payment?.order_id || null,
    amount: Number(amount),
    currency,
    method: `${describePayment(payment)} (${cfg.test ? 'Razorpay test mode' : 'Razorpay'}, ${via})`,
    status: payment?.status || 'captured',
    traveler: details.traveler || payment?.notes?.traveler || '',
    email: details.email || payment?.email || '',
    phone: details.phone || payment?.contact || '',
    travelers: Number(details.travelers) || 1,
    destination: details.destination || '',
    startDate: details.startDate || '',
    endDate: details.endDate || '',
    notes: details.notes || '',
    picks,
    confirmedAt: new Date().toISOString(),
  };
}
