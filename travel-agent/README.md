# Travel Concierge Agent

The agent half of the hackathon project (see `../plan.md` for the full
picture). This is a standalone Node script — **zero npm dependencies** — that
shells out to the `webcmd` CLI to:

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

## Two ways to run this

There are two pieces here, and they answer "how does the user actually use
this?" differently:

1. **`agent-prompt.md`** — a natural-language task for an AI coding agent
   (Claude Code, Codex CLI, etc.) with the `webcmd-browser` skill loaded.
   The user's only interaction is handing an AI agent this prompt (filled in
   with trip details); the AI does every step of the actual browsing —
   deciding what to click/type on each live page, adapting when a page
   doesn't look like what it expected — in the background, then reports a
   table and writes the JSON file. **This is the intended way to use
   webcmd** (see `docs/concepts.mdx`: *"You do not need to describe
   selectors or browser steps; the agent determines those from the live
   website."*).
2. **`src/index.js`** — the deterministic Node script described below. It
   also drives webcmd, but through pre-written URLs and regexes decided
   ahead of time, with no reasoning in the loop. It's faster and free to
   run, and fine once a platform's search behavior is confirmed stable, but
   it can only handle the specific failure cases someone thought to code
   for — an AI agent (path 1) handles a *new* surprise the same way it
   handles the last one, with no code change.

Use `agent-prompt.md` as the primary path. Use `src/index.js` for a quick,
no-AI-cost dry run of the plumbing (arg parsing, session/JSON structure) or
once you've hand-verified a platform's interaction and want it to run the
same way every time.

**What was actually run live on 2026-09-12:** this environment had no
Anthropic API key available to drive `agent-prompt.md` as a real agentic
loop, so the verification pass below used `src/index.js` (path 2) for full
runs, plus a short manual session — issuing `webcmd` commands by hand and
reading an act-mode snapshot of Skyscanner's homepage to confirm a real
search form is reachable there — as a proof of concept for what path 1
would do adaptively. See "Verified live" below for exactly what that found,
including three real bugs it caught and fixed in `src/index.js`/`src/lib/`.
Path 1 itself is still unexecuted — that's the next thing to actually try,
ideally by whoever has API/Claude Code access to run it for real.

## Prerequisites

- Node.js ≥ 20.6 (no other install step — no `npm install` needed here).
- `webcmd` installed and working: `npm install -g @agentrhq/webcmd`, then
  `webcmd doctor` should report OK. See the repo root `README.md` / `start.md`
  if not.

## Usage

```bash
cd travel-agent

# Free text (heuristic parsing — see "Free text parsing" below):
node src/index.js "Trip to Goa from Mumbai, 12 Oct to 15 Oct, budget 30000 for 2 travelers"

# Or explicit flags (more reliable):
node src/index.js --to Goa --from Mumbai --start-date 2026-10-12 --end-date 2026-10-15 --budget 30000 --travelers 2

# See the plan without touching webcmd or any real site at all:
node src/index.js --to Goa --from Mumbai --dry-run
```

Run `node src/index.js --help` for the full flag list (`--profile`,
`--trip-name`, `--out-dir`, `--skip`, etc.).

`--dry-run` is the safe way to sanity-check a change: it prints every URL and
Session name the run would use without invoking `webcmd` at all.

## What actually happens per category

For each of Skyscanner (flights), ixigo Trains (trains), JustDial (cabs),
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
| MEDIUM | ixigo Trains | Its homepage alone yields real fare data — confirmed live. |
| LOW | Skyscanner, JustDial, MakeMyTrip, Goibibo | Deep link and/or homepage load, but the real prices are behind a search interaction a static scrape can't do — confirmed live; needs `agent-prompt.md` run for real, or hand-verified per-site selectors. |

Whatever the confidence, the agent still opens *a* tab for every platform —
worst case it's the homepage instead of a pre-filled search.

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
  [flights] Skyscanner — profile "travel-agent", session "travel-goa-1234-flights-skyscanner"
  ...
```

Re-inspect any of them later with:

```bash
webcmd --profile travel-agent --session <session-id> browser tabs
```

Nothing accumulates automatically beyond what `webcmd` itself retains —
clean up old Sessions yourself with `webcmd --profile travel-agent session
close <id>` once you're done with a given run, or between demo rehearsals.

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
      "platform": "Skyscanner",
      "platformId": "skyscanner",
      "url": "https://www.skyscanner.net/...",
      "homepage": "https://www.skyscanner.net/",
      "usedFallbackHomepage": false,
      "confidence": "MEDIUM",
      "profile": "travel-agent",
      "sessionId": "travel-goa-1234-flights-skyscanner",
      "candidates": [{ "title": "...", "price": 4523, "currency": "INR", "rawLine": "..." }],
      "pick": { "title": "...", "price": 4523, "currency": "INR", "rawLine": "..." },
      "error": null,
      "fetchedAt": "2026-09-12T12:00:01.000Z"
    }
    // one entry per platform per category
  ],
  "places": { "query": "things to do in Goa", "url": "https://www.google.com/search?q=...", "shortlist": ["...", "..."], "sessionId": "..." },
  "openTabs": [{ "profile": "travel-agent", "sessionId": "...", "category": "flights", "platform": "Skyscanner" }]
}
```

This is the file the website's price-comparison page (`results`, grouped by
`category`) and per-platform "choose this platform" buttons should read —
`sessionId`/`profile` on each result is what ties a button back to the tab
that's already open for it. The dummy details+payment page doesn't need
anything from this file; it's a standalone step (see `../plan.md`).

## Known gaps / next steps (for whoever tests this)

- **Run `agent-prompt.md` for real.** Live testing on 2026-09-12 (see above)
  confirmed the gap it's meant to close: Skyscanner, JustDial, MakeMyTrip,
  and Goibibo all need an actual search interaction (type origin/
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
