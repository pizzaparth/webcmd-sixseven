# WhatsApp channel — setup

People can run the whole flow from WhatsApp: describe a trip → get the
price comparison as a message + a "Choose" list → pick a platform per
category (each pick replies with the exact link) → dummy checkout with a
single *Pay (dummy)* tap. The bot lives in `web/whatsapp.js` and is served
by the same `node web/server.js` at **`/webhooks/whatsapp`**.

Picks and the fake confirmation made on WhatsApp are mirrored into the
website's in-memory state, so the `/summary` page on the projector follows
what happens on the phone. No card details are ever asked for in chat.

It targets the **WhatsApp Cloud API (Meta)** directly — plain `fetch`, no
SDK, no BSP in between. You bring a Meta developer app and a phone number.

## 1. What you need from Meta (~15 minutes)

1. **Meta for Developers** → https://developers.facebook.com/apps → *Create app*
   → type **Business** → give it a name.
2. In the app dashboard → *Add product* → **WhatsApp** → *Set up*. This
   creates/links a WhatsApp Business Account (WABA).
3. Open **WhatsApp → API Setup**. You'll see:
   - a **temporary access token** (24 h) — fine for the first test → `WHATSAPP_TOKEN`
   - a **test phone number** with its **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - *"To"* recipients: add the phone(s) you'll test from (up to 5 for the
     test number; each gets an OTP on WhatsApp).
4. **Use your own number instead of the test number** (you said you have one):
   WhatsApp → API Setup → *Add phone number* → fill the business profile →
   verify by SMS/voice. The number must **not** currently be registered in
   the WhatsApp / WhatsApp Business app — delete the account from the app
   first (Settings → Account → Delete my account), then add it here. After
   it's verified, use *its* Phone number ID.
5. **Permanent token** (so it doesn't expire mid-demo): Business Settings
   (https://business.facebook.com/settings) → *Users → System users* → add a
   system user (admin) → *Add assets* → your app (full control) →
   *Generate new token* → scopes `whatsapp_business_messaging` +
   `whatsapp_business_management`. Paste as `WHATSAPP_TOKEN`.
6. **App secret**: App dashboard → *App settings → Basic* → *App secret* →
   `WHATSAPP_APP_SECRET`. With it set the server verifies
   `X-Hub-Signature-256` on every delivery and rejects anything else. Set it
   for anything reachable from the internet.

## 2. Expose the server and register the webhook

Meta must reach your machine over **https**. Easiest: a tunnel.

```bash
cd travel-agent
cp .env.example .env          # fill WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
                              # WHATSAPP_VERIFY_TOKEN (any string you invent), WHATSAPP_APP_SECRET
node web/server.js            # -> "WhatsApp: webhook at .../webhooks/whatsapp"

# in another terminal — pick one:
ngrok http 4173                                   # free plan gives a random https URL (or 1 static domain)
cloudflared tunnel --url http://localhost:4173     # Cloudflare quick tunnel, free, no account
```

Put the public URL in `.env` as `PUBLIC_BASE_URL=https://xxxx.ngrok-free.app`
(it's what the bot sends as "Comparison page" / "Summary page" links) and
restart the server.

Then in the Meta app: **WhatsApp → Configuration → Webhook → Edit**:

| Field | Value |
| --- | --- |
| Callback URL | `https://<your-tunnel>/webhooks/whatsapp` |
| Verify token | the exact `WHATSAPP_VERIFY_TOKEN` from `.env` |

*Verify and save* — the server logs `[whatsapp] webhook verified`. Then
**Manage** → subscribe to the **`messages`** field. That's it: send "hi"
to the number from a test recipient phone.

Quick local check without Meta:

```bash
curl "http://127.0.0.1:4173/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<your token>&hub.challenge=123"
# -> 123
```

## 3. The conversation

```
you:  hi
bot:  welcome + example
you:  Trip to Goa from Mumbai, 12 Oct to 15 Oct, 2 travelers, budget 30000
bot:  parsed trip (buttons: Search 🔍 / Edit ✏️)
bot:  🔍 searching…  →  results per category with prices + best total
      🗺 things to do + Google link
      [list] Choose a platform  (one row per platform, price in the description)
you:  tap "Skyscanner"
bot:  ✅ chosen, link to open, running total  (buttons: Choose more / Checkout (dummy))
you:  Checkout → name ("same" reuses your WhatsApp name) → travelers
bot:  dummy payment summary  (buttons: Pay (dummy) / Change picks)
you:  Pay (dummy)
bot:  🎉 fake confirmation, all tab links, summary-page link  (button: New trip)
```

Commands anywhere: `help`, `choose`, `checkout`, `web`, `reset`.

**Trip parsing**: with `ANTHROPIC_API_KEY` set the message is parsed by
Claude (structured output, handles "next weekend", "for 2 of us", etc.);
otherwise the CLI's regex heuristic from `src/lib/args.js` is used.

**Search**: if `webcmd` is installed and the server wasn't started with
`--no-open`, the bot runs the real agent (`runTrip`) for that trip — the
same Sessions/tabs as the CLI, written to `output/wa-<city>-<ts>.json` —
and messages back when done (a couple of minutes). Otherwise it answers
from the trip file the server loaded (sample or newest `output/*.json`)
and says so ("Using the latest search snapshot").

## 4. Cost / free usage (checked 2026-09-12)

- **Cloud API access is free.** Meta bills per message *template* the
  business initiates. Everything this bot sends is a **reply inside the
  24-hour customer-service window** the user opened by messaging first —
  and those service replies have been **free and unlimited since Nov 2024**.
- **Heads-up:** Meta announced that from **1 Oct 2026** service messages
  inside the window become billable again. For a demo the volume is
  negligible either way, but check the pricing page if you run it past then.
- The **test number** on a new app can message up to **5 verified
  recipients** for free — enough for a demo without adding your own number.
- No template messages are used, so nothing needs template approval.
- Tunnels: ngrok and Cloudflare quick tunnels are free for this kind of use.

Sources: [Is the WhatsApp API free? (Unipile)](https://www.unipile.com/is-the-whatsapp-api-free/),
[WhatsApp API pricing 2026 (Chatarmin)](https://chatarmin.com/en/blog/whats-app-api-pricing),
[WhatsApp Business API pricing 2026 (Blueticks)](https://blueticks.co/blog/whatsapp-business-api-pricing-2026).

## 5. Limits & gotchas

- Interactive messages: max **3 buttons** (titles ≤ 20 chars) or a **list
  of ≤ 10 rows** — the bot slices to these. With more than ~10 platforms the
  list would need paging.
- Meta retries a delivery it didn't get a `200` for within seconds. The
  handler acks immediately and processes asynchronously, and de-duplicates
  by message id.
- Delivery/read *statuses* also arrive on the same webhook; they're ignored.
- Sessions are per phone number and in memory — a server restart forgets
  them (say `hi` again). Nothing is written to disk except the agent's
  normal `output/*.json` for live searches.
- The temporary token expires after 24 h → use the system-user token (§1.5).
- Only `text` and `interactive` replies are handled; voice notes/images get a
  polite "text only" reply. (Voice notes could be routed through the same
  Deepgram/Groq STT as the website's voice agent — not wired yet.)

Not run against a real Meta app yet: the webhook handshake, signature
check, and the full conversation were exercised locally with the Graph API
send mocked (see the simulated transcript in the PR/commit). The first
real message from a phone is the next step once the app + number exist.
