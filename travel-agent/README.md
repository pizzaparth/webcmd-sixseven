# Travel Concierge Agent

The agent half of the hackathon project (see `../plan.md` for the full
picture). This is a standalone Node script — **zero npm dependencies** for the agent
and website (the optional cloud voice engine adds `@anthropic-ai/sdk`, see
`VOICE.md`) — that shells out to the `webcmd` CLI to:

1. Search a real site per category (flights, trains, cabs, hotels) and open
   a tab on the best result it can find. No login, no checkout, no form
   submission on any of these — search and open only.
2. Run a plain Google search for places to explore in the destination city.
3. Log a comparison table to the CLI (platform / price / confidence / URL).
4. Write everything it found to `output/<trip>.json`, for Adarsh's website
   side to build the real price-comparison page + the dummy details/payment
   page from.

It never closes anything it opens — every Session/tab is left running on
purpose (see "Retained sessions" below).

## Three ways to run this

1. **`src/run-agent.js` — the primary path.** CLI input in, `claude` CLI
   underneath, Claude AI as the actual browsing agent:

   ```bash
   node src/run-agent.js "Trip to Goa from Mumbai, 12 Oct to 15 Oct, budget 30000 for 2 travelers"
   # or: npm run agent -- --to Goa --from Mumbai --start-date 2026-10-12 --budget 30000 --travelers 2
   ```

   It builds the task prompt (`src/lib/prompt.js`) and spawns
   `claude -p "<prompt>" --permission-mode bypassPermissions` (see
   `src/lib/claude-agent.js`) in this repo's directory. Claude Code loads the
   `webcmd-browser` skill and drives webcmd itself from there — reading live
   pages, deciding what to click/type, adapting to a CAPTCHA or an
   unexpected layout — using whatever `claude` auth is already on the
   machine (no separate `ANTHROPIC_API_KEY` needed). This is the actual
   "AI does the processing in the background" architecture. Progress
   streams live to the terminal (`--output-format stream-json`) rather than
   going silent until the end — confirmed live that plain text mode looks
   "frozen" on a run that genuinely takes several minutes. `--dry-run`
   prints the exact prompt without calling `claude` at all;
   `--max-budget-usd` (default 6 — a full 5-platform run needs more than
   the original default of 2, confirmed live) caps spend, since it's
   browsing several real sites; `--model` picks a model.
2. **`agent-prompt.md`** — the human-readable reference for the prompt
   `prompt.js` generates, for pasting into a chat session by hand instead of
   running `run-agent.js`. Keep the wording in sync if you edit either.
3. **`src/index.js`** — a deterministic Node script, no AI in the loop at
   all: pre-written URLs and regexes decided ahead of time. Free and fast,
   and fine once a platform's search behavior is confirmed stable, but it
   can only handle the specific failure cases someone thought to code for —
   `run-agent.js` handles a *new* surprise the same way it handles the last
   one, with no code change. Useful for a quick, no-cost check of the
   plumbing (arg parsing, session/JSON structure).

**`run-agent.js` (path 1) has been run live**, on 2026-09-12, for flights +
places (`--skip trains,cabs,hotels`, Goa from Mumbai). What actually
happened, with zero code changes needed:

- Claude loaded the `webcmd-browser` skill, created two Sessions, and drove
  Skyscanner's homepage adaptively — the origin field came pre-filled with a
  geo-IP default city (confirming it was reading a real live page, not
  guessing), and it was mid-way through typing the destination when
  **Skyscanner's PerimeterX bot-check interstitial took over the tab**. It
  tried a reload and a fresh Session; both landed on the same captcha. Per
  the prompt's hard rules, it did **not** attempt to solve the CAPTCHA and
  did **not** guess a price — it wrote `pick: null` with a specific,
  accurate error message instead.
- The places step worked cleanly and returned a real answer (the same beach
  list `src/index.js` found separately: Baga, Calangute, Arambol, Anjuna,
  Morjim, Sinquerim, Majorda, Benaulim & Varca, Agonda, Palolem).
- It wrote `output/<trip>.json` matching the documented schema exactly on
  the first try, having read `src/lib/types.js` itself.
- It correctly left both Sessions open (never called `session close`), and
  proactively flagged — without touching them — that the `travel-agent`
  Profile had accumulated many idle Sessions from earlier `src/index.js`
  test runs, which is genuinely useful behavior no fixed script would think
  to do.

This is a stronger, more specific finding than the manual pass below: the
bot-check isn't just on a guessed deep link, it can trigger **mid-interaction
on the homepage itself** — homepage-first doesn't fully dodge PerimeterX,
only an actual signed-in account with enough trust signal might, and that's
out of scope here (no login, per the hard rules). **Skyscanner has since
been dropped from `src/lib/sites.js` entirely and replaced with ixigo
Flights** (same domain already used for trains, which never showed a
CAPTCHA in any test) — see "Confidence levels" below for the current list.

Before that, `src/index.js` (path 3) was run for full runs, plus a short
manual session — issuing `webcmd` commands by hand and reading an act-mode
snapshot of Skyscanner's homepage to confirm a real search form is reachable
there — which found and fixed three real bugs (below).

## Prerequisites

- Node.js ≥ 20.6. The agent and the website need no dependencies of their own;
  `npm install` here is only needed for the optional cloud voice/WhatsApp
  features (`@anthropic-ai/sdk`).
- `webcmd` installed and working. Either:
  - `npm install -g @agentrhq/webcmd`, or
  - from this repo root, `npm install && npm run build` — the agent finds and
    uses `dist/src/main.js` directly.

  The agent resolves webcmd's JS entry point and runs it with your own Node
  rather than exec'ing the `webcmd` bin, because npm installs that bin on
  Windows as a `.cmd` shim that Node cannot execute directly. Set `WEBCMD_BIN`
  to override which one it uses.
- **First run downloads a browser.** `webcmd doctor` fetches a stealth Chromium
  (a few hundred MB) the first time; it looks like a hang but is not. Run
  `webcmd doctor` once on its own and let it finish before the first agent run.

Run `npm test` in `travel-agent/` to check the agent's parsing/extraction logic
and the website's routes without touching the network or a browser.

## Usage

```bash
cd travel-agent

# Primary path — Claude AI drives webcmd (see "Three ways to run this" above):
node src/run-agent.js "Trip to Goa from Mumbai, 12 Oct to 15 Oct, budget 30000 for 2 travelers"
node src/run-agent.js --to Goa --from Mumbai --start-date 2026-10-12 --end-date 2026-10-15 --budget 30000 --travelers 2
node src/run-agent.js --to Goa --from Mumbai --dry-run   # print the prompt, call nothing

# Deterministic fallback, no AI/cost — same flags, different engine:
node src/index.js --to Goa --from Mumbai --start-date 2026-10-12 --end-date 2026-10-15 --budget 30000 --travelers 2
node src/index.js --to Goa --from Mumbai --dry-run
```

Run `node src/run-agent.js --help` (or `src/index.js --help`) for the full
flag list — both share the same parser: `--profile`, `--trip-name`,
`--out-dir`, `--skip`, plus `run-agent.js`-only `--model` and
`--max-budget-usd`.

`--dry-run` is the safe way to sanity-check a change: it prints every URL/
prompt and Session name the run would use without invoking `webcmd` (or, for
`run-agent.js`, `claude`) at all.

## Using your own Chrome identity (optional)

A webcmd **Profile** is normally not your regular, already-signed-in
desktop Chrome — it's an isolated Webcmd-managed Chrome identity that
starts completely blank. That's why every site sees a run as a fresh guest
by default, regardless of who you're actually signed in as elsewhere.
Neither entry point ever drives your literal, live daily Chrome window —
that's a deliberate boundary, not a limitation (an autonomous agent
shouldn't be loose in the same window as your real open tabs and sessions).

There's a real, supported bridge though: **webcmd can import a real native
Chrome profile's cookies into its own managed `default` Profile.** Run once
on this machine (2026-09-12) and confirmed live — a fresh session under
`--profile default` opened `myaccount.google.com` already signed in as
"Parth (parthnotparth@gmail.com)", no login prompt:

```bash
# Find your real Chrome profile folder names first if you're not sure which
# is which — "Default" is usually your everyday one:
ls "$HOME/Library/Application Support/Google/Chrome/" | grep -i "profile\|default"

webcmd setup --browser chrome --chrome-profile Default --import-chrome-cookies
```

**Understand what this actually does before running it:** it copies real
cookies out of your real Chrome profile into webcmd's managed storage. From
then on, any Webcmd Session under that Profile is authenticated as you —
not just on Google, but on anything you happened to be signed into in that
Chrome profile at import time. An autonomous run (especially the
Claude-driven path, unattended) then has that same access. The hard rules
in `src/lib/prompt.js`/`agent-prompt.md` (read-only, no login, no checkout,
no payment forms) matter more once a Profile is genuinely you, not less —
they're what keeps an authenticated run from doing anything with that
access beyond searching and reading. Re-run the same command any time your
real cookies change (e.g. after a fresh sign-in) to refresh the import.

Both entry points resolve which Profile to use the same way
(`src/lib/profile.js`), unless you pass `--profile <name>` explicitly:

1. **`default`** — webcmd's own implicit Profile. Always exists, so it's
   always the choice unless overridden. On this machine it's the real
   imported identity above; on a machine where that import was never run,
   it's simply another blank profile.
2. Pass `--profile travel-agent` explicitly to force the isolated guest
   Profile even on a machine that has done the import (e.g. to deliberately
   test what a logged-out visitor sees).

Prefer not to import real cookies? The narrower alternative is a one-time
*manual* sign-in inside an isolated Profile — only whatever you explicitly
sign into there is ever exposed, nothing else from your real browser:

```bash
webcmd profile create personal
webcmd --profile personal session create "auth-setup" -f json   # note the session id
webcmd --profile personal --session <that-id> browser run --stdin <<'JS'
await page.goto('https://accounts.google.com/');   # or any site's login page
return { url: page.url() };
JS
# Sign in by hand in the Chrome window that opens (never paste credentials
# into a webcmd command or into chat). Repeat the goto for each site you
# want persistently signed in, then run with --profile personal.
```

**Caveat either way, confirmed live on 2026-09-12:** neither approach
eliminates bot-detection walls like Skyscanner's PerimeterX check — an
authenticated, human-browsed profile may look less suspicious than a
completely fresh one, but it's not a guaranteed fix.

## What actually happens per category

For each of ixigo Flights (flights), ixigo Trains (trains), JustDial (cabs),
and MakeMyTrip + Goibibo (hotels):

1. Create a dedicated webcmd **Session** (one Session per platform — see
   "Why one Session per platform" below).
2. Try a best-effort deep-link search URL for that platform (see
   `src/lib/sites.js`). If none is available, or the page it lands on looks
   like a dead end (404, CAPTCHA wall, empty page — see
   `src/lib/extract.js#looksLikeDeadEnd`), it falls back to that platform's
   plain homepage instead. Either way, **a tab stays open on that platform.**
3. Reads the page with `webcmd browser snapshot --snapshot-mode read` and
   scans the text for currency-amount patterns to build a short list of
   price/title candidates. The cheapest one becomes that platform's "pick."

The places-to-explore step tries webcmd's own documented fast path first —
`webcmd web fetch` (no browser) — and only opens a browser Session if that's
blocked or needs rendering, exactly as `docs/cli-reference.mdx` recommends.

## Verified live (2026-09-12)

Ran `src/index.js` end to end three times against real sites (Goa from
Mumbai, 12–15 Oct 2026, 2 travelers) plus some manual `webcmd` commands.
Found and fixed three real bugs no amount of reading the code would have
caught:

1. **Profiles aren't lazily created.** `docs/cli-reference.mdx` implies
   local-mode Profiles are created on first use; this installed version
   (webcmd 0.8.4) actually errors with `PROFILE_NOT_FOUND` until
   `webcmd profile create <name>` has been run once. Fixed:
   `src/lib/webcmd.js#ensureProfile`, called before any session work.
2. **Dead-end detection missed Skyscanner's actual wording.** Its bot-check
   page says *"Are you a **person or a** robot?"*, not the exact phrase
   `"are you a robot"` that was being matched for — so the CAPTCHA page was
   silently treated as normal content. Fixed: `src/lib/extract.js`'s
   `NEGATIVE_SIGNALS` now matches `"or a robot"`.
3. **Extraction ran on whole-page blobs, not lines.** `browser snapshot`'s
   `tree` field is one big multi-line string; without splitting it first,
   every match's "title" collapsed to the page's first 140 characters
   regardless of where the price actually was (this is why an early run
   "found" ₹500 on MakeMyTrip's homepage from unrelated marketing copy).
   Fixed: `src/lib/extract.js#splitToLines`, now run before both
   `extractPriceCandidates` and `extractTextShortlist`. Also found and fixed
   a related gap where `webcmd web fetch` on a JS-rendered Google results
   page returned HTTP 200 with a generic "having trouble accessing..." body
   (`extractionSource: "fallback"`) instead of an explicit blocked code —
   `src/lib/places.js#fetchWasBlocked` now treats that as blocked too.

**What worked well after the fixes:** ixigo Trains' homepage has a real fare
table server-rendered into the page, and read-mode snapshot + the fixed
extractor pulled out genuine fare-class prices (Second Class ₹15, Sleeper
₹126, AC Chair Car ₹205, ...). The Google places step, once the fetch-block
fix landed, got a real answer on the browser fallback: readability pulled
"*The famous beaches to visit in Goa are Baga, Calangute, Arambol, ...*"
straight out of the search results page.

**What's still weak, and why:** Skyscanner, JustDial, MakeMyTrip, and
Goibibo did not yield a real price. Skyscanner's own deep-link page loaded
fine on one run and hit a CAPTCHA on another (bot-check is intermittent, not
guessed-URL-specific) — but even on the clean run, its actual flight results
are a client-rendered React app; read-mode (readability) snapshot only
picked up static page chrome (title, a login prompt), not the price cards.
JustDial's category page and Goibibo's homepage genuinely don't show a price
until you search. This is the real gap between the two run modes described
above: a **static regex-over-readable-text scrape (`src/index.js`) can't
reach content that only renders after a real search interaction** — that
needs an agent reading an **act-mode** snapshot (which does expose real,
fillable form fields — confirmed live on Skyscanner's homepage: labeled
origin/destination comboboxes, a date button, a search button) and actually
typing/clicking, i.e. `agent-prompt.md`, run for real.

`src/lib/sites.js` still tags every deep-link URL builder with a confidence
level for exactly this reason:

| Confidence | Platforms | Meaning |
| --- | --- | --- |
| MEDIUM | ixigo Flights, ixigo Trains | Deep link returns real, correct data with no CAPTCHA — confirmed live for both. |
| LOW | JustDial, MakeMyTrip, Goibibo | Homepage loads, but the real prices are behind a search interaction a static scrape can't do — confirmed live; needs `agent-prompt.md`/`run-agent.js` run for real, or hand-verified per-site selectors. |

Whatever the confidence, the agent still opens *a* tab for every platform —
worst case it's the homepage instead of a pre-filled search.

**Site list update (post-CAPTCHA-fix), re-verified live:** Skyscanner was
replaced with ixigo Flights for the flights category, specifically because
of the PerimeterX finding above — every "Skyscanner" reference in this
section describes what was actually tested and found (kept as an accurate
record), not the current site list. `src/lib/sites.js`, `src/lib/prompt.js`,
and `agent-prompt.md` all use ixigo Flights now. Re-tested with
`src/index.js` afterward (`--to Goa --from Mumbai --start-date 2026-10-12`):
**no CAPTCHA, and it returned a genuine, correct price** — ₹3,915, a
non-stop IndiGo flight, Mumbai (BOM) → Goa (GOI) — on the very first try,
better than any other platform tested so far including ixigo Trains (which
needed the line-splitting fix first). Confidence bumped to MEDIUM.

**Later the same day — streaming, budget, and real-identity fixes, all
confirmed live:**

- A full `run-agent.js` run hit `Exceeded USD budget (2)` before finishing
  (the original default was sized for a 2-platform test, not the full
  5-platform run) — fixed by raising the default to 6 (see "Three ways to
  run this" above).
- Plain `-p` text-mode output stayed completely silent until the run
  finished or errored, which reads as "hung" on a run that can take several
  minutes — fixed by switching to `--output-format stream-json` and
  pretty-printing each event. Confirmed live: a re-run showed visible,
  incremental progress the whole way (tool calls, reasoning text) across 31
  turns, cost $0.589, and produced a genuinely adaptive result — it
  misclicked a traveler-count widget once (got `adults=4` back in the
  results URL), noticed the wrong value itself, and recovered by reloading
  the same URL with the count corrected rather than blindly retrying.
- **`webcmd setup --browser chrome --chrome-profile Default --import-chrome-cookies`
  genuinely imports a real native Chrome profile's cookies** into webcmd's
  own `default` Profile — confirmed live: a session under `--profile
  default` opened `myaccount.google.com` already signed in, no prompt. This
  always lands in webcmd's implicit `default` Profile specifically, not a
  custom alias (a custom `@`-free alias like the earlier
  `parthnotparth.gmail.com` attempt is a dead end for this purpose — the
  import command doesn't target custom aliases). `src/lib/profile.js` was
  rewritten around this: `PERSONAL_PROFILE` is now `'default'`, and
  resolution no longer needs to detect anything, since `default` always
  exists. See "Using your own Chrome identity" above for the real
  implications of doing this (it's not just a convenience — an unattended
  run then has your real, authenticated access).

## Why one Session per platform (not one Session, many tabs)

webcmd's `browser run` sandbox explicitly cannot call `context.newPage()` —
a Session's script can only navigate its current page, not open new ones. So
to have all five platforms' tabs open side by side, this agent creates one
Session per platform (`travel-<trip>-<category>-<platform>`) under one
Profile, matching the documented pattern for parallel work
(`docs/concepts.mdx`: "Sessions allow separate agents or tasks to work
without competing for the same browser window").

## Retained sessions

Nothing here ever calls `session close` or any tab-closing command — every
Session created by a run stays open, by design (per the request that
produced this code: "retain the pages once your task is complete"). The CLI
output ends with a list of every Session it left open, e.g.:

```
=== RETAINED SESSIONS/TABS (left open on purpose) ===
  [flights] ixigo Flights — profile "travel-agent", session "travel-goa-1234-flights-ixigo-flights"
  ...
```

Re-inspect any of them later with:

```bash
webcmd --profile travel-agent --session <session-id> browser tabs
```

Nothing accumulates automatically beyond what `webcmd` itself retains —
clean up old Sessions yourself with `webcmd --profile travel-agent session
close <id>` once you're done with a given run, or between demo rehearsals.

## Website: price comparison page (`web/`)

The website side of `../plan.md`, built on one shared dark-theme template
(`web/template.js`) that the details+payment and summary pages will reuse.
Zero npm dependencies, like the agent.

```bash
cd travel-agent
node web/server.js                      # newest output/*.json, or the bundled sample if none
node web/server.js output/goa-123.json  # a specific trip file
node web/server.js --no-open            # skip webcmd; "Choose" opens the URL in your browser
# then open http://127.0.0.1:4173/
```

What the page does:

- **Static "live price" banner** — sum of the cheapest captured price per
  category, computed once from the JSON. The "last updated" clock ticks, but
  the number is a snapshot (say so if asked — see plan.md "Risks").
- **One card per platform per category** with the option found, its price
  (or "Price not captured" / homepage fallback note), a confidence badge,
  and a **"Choose `<platform>`" button**. Clicking it `POST`s
  `/api/choose`; the server creates a fresh webcmd Session
  (`travel-<trip>-pick-<category>-<platform>`) and navigates it to that
  result's URL — the agent's original Sessions are left untouched. If
  `webcmd` isn't reachable (or `--no-open`), the response returns the URL
  and the page opens it in your own browser instead.
- **Your picks** — selections live in server memory for the run
  (`GET /api/picks`) so the details+payment and summary pages can read them;
  nothing is written to disk.
- **Summary page** (`/summary`, `web/summary.js`) — the picks (with the
  webcmd Session each one opened), the dummy payment's fake confirmation,
  every Session the search run left open (with links and session ids), and
  the places shortlist.

### WhatsApp channel (`/webhooks/whatsapp`, `web/whatsapp.js`)

The same flow over WhatsApp via the Meta Cloud API: describe a trip →
comparison as a message + "Choose" list → pick per category (each pick
replies with the link) → dummy checkout with one *Pay (dummy)* tap. Picks
and the fake confirmation mirror into the website's summary page. Setup
(Meta app, your number, tunnel, webhook, free-tier notes):
**[WHATSAPP.md](WHATSAPP.md)**. Needs `WHATSAPP_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` in `.env`.

### Shared design template (`web/template.js`)

All three pages render through `renderPage()` and the class set in
`template.js` — there is no per-page CSS. It encodes plan.md's rules: dark
theme, flat solid colors, one amber accent, no gradients, no translucent
pill badges, and every badge/text pair checked for contrast (all pairs pass
WCAG AA; the lowest is 5.05:1). To add a page, write markup against the
existing classes (`.card`, `.badge.ok|warn|bad|info|neutral|accent`,
`.btn[.secondary][.block]`, `.banner`, `.grid`, `.field`, `.tabs`, `.kv`,
`.notice`, `.status`, `.table-wrap`) and pass it to `renderPage()`.

### Details + dummy payment page (`/checkout`, `web/checkout.js`)

One screen: the trip-details form (name, email, phone, travelers, dates,
requests — pre-filled from the trip intent where known) next to a
Razorpay-*style* payment widget (Card or UPI tab). It lists the picks from
the comparison page and uses their total as the amount (falling back to the
banner's best total if nothing was picked).

- **Entirely dummy.** No SDK, no gateway, no network call for payment.
  "Pay" validates the fields locally, waits a beat, and shows a fake
  confirmation (`pay_DEMO…` / `order_DEMO…`). In server mode it also POSTs a
  **non-sensitive** summary (ids, amount, method label, traveler name,
  dates) to `/api/confirm` in memory so the summary page can show it — card
  number, expiry, CVV and UPI id never leave the tab.
- **"Fill test values"** drops in obviously-fake data (4111 1111 1111 1111,
  `test@demo`, etc.). Say out loud in the demo that everything is fake.
- **🎤 Voice fill** walks name → phone → travelers → card/UPI → the matching
  payment fields, highlighting the field being filled, retrying up to 3×
  per question and skipping if it still can't parse the answer. Fields stay
  editable by hand afterwards. Two engines (see **[VOICE.md](VOICE.md)** for
  keys, free tiers, and setup): the browser's Web Speech API by default
  (free, no keys), or — with keys in `.env` — a cloud engine using Deepgram
  / Groq for speech-to-text, Deepgram / ElevenLabs for the voice, and
  Claude to turn spoken answers into exact field values. Cloud calls fall
  back to the browser engine if they fail.

`node web/build.js output/<trip>.json` writes standalone
`output/<trip>.html` + `.checkout.html` + `.summary.html` instead (no server;
buttons open URLs directly, picks pass between pages via `sessionStorage`).
`web/fixtures/sample-trip.json` is a hand-written example of the output
schema below, used when `output/` is empty so the page can be demoed
before a real run.

## Free text parsing

`src/lib/args.js#parseFreeText` is a small regex-based heuristic (destination
via "to `<City>`", origin via "from `<City>`", a date range, "budget `<n>`",
"`<n>` travelers") — not an NLP model. It's a convenience for demoing the
CLI with a natural sentence; **explicit flags always win** and are the
reliable path if the heuristic guesses wrong.

## Output schema (`output/<trip>.json`)

See `src/lib/types.js` for full JSDoc typedefs. Shape:

```jsonc
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-09-12T12:00:00.000Z",
  "intent": { "destination": "Goa", "origin": "Mumbai", "startDate": "...", "budget": 30000, "currency": "INR", "travelers": 2, /* ... */ },
  "profile": "travel-agent",
  "results": [
    {
      "category": "flights",
      "platform": "ixigo Flights",
      "platformId": "ixigo-flights",
      "url": "https://www.ixigo.com/flights",
      "homepage": "https://www.ixigo.com/flights",
      "usedFallbackHomepage": true,
      "confidence": "LOW",
      "profile": "travel-agent",
      "sessionId": "travel-goa-1234-flights-ixigo-flights",
      "candidates": [{ "title": "...", "price": 4523, "currency": "INR", "rawLine": "..." }],
      "pick": { "title": "...", "price": 4523, "currency": "INR", "rawLine": "..." },
      "error": null,
      "fetchedAt": "2026-09-12T12:00:01.000Z"
    }
    // one entry per platform per category
  ],
  "places": { "query": "things to do in Goa", "url": "https://www.google.com/search?q=...", "shortlist": ["...", "..."], "sessionId": "..." },
  "openTabs": [{ "profile": "travel-agent", "sessionId": "...", "category": "flights", "platform": "ixigo Flights" }]
}
```

This is the file the website's price-comparison page (`results`, grouped by
`category`) and per-platform "choose this platform" buttons should read —
`sessionId`/`profile` on each result is what ties a button back to the tab
that's already open for it. The dummy details+payment page doesn't need
anything from this file; it's a standalone step (see `../plan.md`).

## Known gaps / next steps (for whoever tests this)

- **Run `agent-prompt.md`/`run-agent.js` for the rest of the categories.**
  Live testing on 2026-09-12 (see above) confirmed the gap it's meant to
  close: ixigo Flights, JustDial, MakeMyTrip, and Goibibo all need an actual
  search interaction (type origin/
  destination, pick a date, submit) to reach real prices, and a static
  regex-over-readable-text scrape structurally can't do that. This needs
  either an AI agent (path 1) or hand-verified per-site selectors (below) —
  it was not run for real in this pass for lack of an API key in this
  environment.
- Alternative to the above: give `src/lib/sites.js`'s LOW-confidence
  platforms a real interaction script by hand (someone drives the site once
  in a real browser, notes the actual field/button selectors, encodes that
  as a `browser run` script in `src/lib/scripts.js`). `src/lib/category.js`
  already handles "try N candidate URLs, fall back to homepage" generically
  — only the per-platform interaction needs adding.
- The price/title extraction in `src/lib/extract.js` is a generic
  regex-over-readable-text heuristic, not a per-site selector — confirmed
  live that it works well when a page's real content is readable-mode
  friendly (ixigo Trains' fare table, Google's results page) and not at all
  when the content is behind client-side rendering the search step above
  hasn't triggered yet.
- Category runs are sequential today (simplest to debug first — this is how
  they were run live). Since each category/platform uses its own Session,
  they're independent and could run concurrently (`Promise.all`) once
  needed for speed.
