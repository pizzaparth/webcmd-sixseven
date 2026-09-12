# Payments — Razorpay setup

The details + payment page (`/checkout`) and the WhatsApp bot take real
payments through **Razorpay** when keys are configured, and fall back to
the plan's dummy widget when they aren't. Everything is in `web/razorpay.js`
(server, plain `fetch`) and the checkout page's inline script (Razorpay's
hosted Checkout modal). **Card/UPI details are entered in Razorpay's own UI
and never reach this server or page.**

| Mode | Keys | Money | Where it's used |
| --- | --- | --- | --- |
| **Dummy** (default) | none | none — fake confirmation | web page, WhatsApp one-tap |
| **Razorpay Test** | `rzp_test_…` | none — test cards / test UPI | web (Checkout modal), WhatsApp (Payment Link) |
| **Razorpay Live** | `rzp_live_…` | real | same, after KYC |

## 1. Get test keys (free, ~5 minutes)

1. Sign up at https://dashboard.razorpay.com (email + phone; no KYC needed
   for test mode).
2. Make sure the dashboard toggle (top) says **Test Mode**.
3. **Account & Settings → API Keys → Generate Test Key.** Copy both:
   - Key ID → `RAZORPAY_KEY_ID` (starts with `rzp_test_`)
   - Key Secret → `RAZORPAY_KEY_SECRET` (shown once — download it)
4. `travel-agent/.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
   ```
5. Restart `node web/server.js` — it prints `Payments: Razorpay TEST mode`.

Test mode is free with no limits that matter here. Live mode needs KYC
(business details, bank account) and charges Razorpay's standard fee per
successful transaction (about 2% + GST on domestic cards/UPI; no setup or
annual fee) — check https://razorpay.com/pricing/ for current numbers.

## 2. Test instruments

| Method | Value |
| --- | --- |
| Card (success) | `4111 1111 1111 1111`, any future expiry, any CVV, any name |
| Card (failure) | `4000 0000 0000 0002` |
| UPI (success) | `success@razorpay` |
| UPI (failure) | `failure@razorpay` |
| Netbanking / wallets | any option in the test checkout succeeds |

Razorpay's full list: https://razorpay.com/docs/payments/payments/test-card-details/

## 3. How the web flow works

```
Pay with Razorpay (test)
  → POST /api/razorpay/order      server computes the amount from the picks (never trusts the client),
                                  creates an Order (POST /v1/orders), remembers it in memory
  → Razorpay Checkout modal       key_id + order_id + prefill (name/email/phone from the form)
  → handler(response)             razorpay_payment_id / order_id / signature
  → POST /api/razorpay/verify     HMAC-SHA256(order_id|payment_id, key_secret) must match,
                                  fetch the payment (method, last4/vpa), capture if only authorized
  → confirmation                  shown on the page + on /summary; never card data beyond network/last4
```

The voice agent skips the card/UPI questions in this mode (Razorpay
collects the instrument) and only fills the traveler details.

## 4. WhatsApp: Payment Links

With keys set, the WhatsApp bot's pay step creates a **Payment Link**
(`POST /v1/payment_links`) and sends the `rzp.io/…` URL. The user pays on
Razorpay's hosted page on their phone. The bot learns it's paid in one of
three ways:

1. **Callback** — the link redirects to
   `PUBLIC_BASE_URL/payments/razorpay/callback`; the server verifies the
   signature (`payment_link_id|reference_id|status|payment_id`), records the
   confirmation, shows a confirmation page, and messages the user.
2. **Webhook** (recommended for reliability) — see §5.
3. **"I've paid" button** — the bot fetches the link status from Razorpay
   and confirms if `paid`.

## 5. Webhook (optional but recommended)

1. Dashboard → **Account & Settings → Webhooks → Add New Webhook**.
2. URL: `https://<your public host>/webhooks/razorpay` (the same tunnel you
   use for WhatsApp — see WHATSAPP.md §2).
3. Set a **secret** and put it in `.env` as `RAZORPAY_WEBHOOK_SECRET`.
4. Events: `payment.captured`, `payment_link.paid` (others are ignored).

The server verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body
with the webhook secret) and rejects anything else with 401.

## 6. Gotchas

- Orders live in server memory: if you restart the server between creating
  an order and paying, verification answers "Unknown order". Just pay again.
- Minimum amount is ₹1. If none of the picks captured a price, the page
  falls back to the banner's best total; WhatsApp asks you to pick a priced
  option.
- Auto-capture: new Razorpay accounts capture automatically. If yours is
  set to manual, the server captures the payment itself after verifying.
- The Checkout script (`checkout.razorpay.com/v1/checkout.js`) needs
  internet; the page reports if it didn't load.
- `.env` is gitignored — never commit the key secret. The Key ID alone is
  safe in the browser (Razorpay's Checkout needs it).

Verified in this repo: order/verify/callback/webhook routes, signature
maths (unit-checked), and the page flow up to Razorpay's API — with fake
keys Razorpay returns `401 Authentication failed`, which the page surfaces.
First run with real test keys is the next step.
