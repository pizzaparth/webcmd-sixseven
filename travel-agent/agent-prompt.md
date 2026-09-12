# Travel Concierge Agent — prompt

This is the actual "agent" for this project, in the sense webcmd is built
around: **a natural-language task for an AI coding agent that has the
`webcmd-browser` skill loaded** (Claude Code, Codex CLI, etc.), not a fixed
script. Give it this prompt (filled in with real trip details) and let it
drive the browser adaptively — reading whatever the live page actually shows
and deciding what to click/type, the way `docs/agent-prompts.mdx` describes.

See `README.md` → "Three ways to run this" for why this exists alongside
`src/index.js`, and "Verified live (2026-09-12)" for what live testing
already confirmed and disproved about specific URLs — including why
Skyscanner was dropped for flights in favor of ixigo Flights (its deep link
*and* homepage both triggered a PerimeterX bot-check, once even
mid-interaction; ixigo.com never showed a CAPTCHA in any test).

## Template (fill in the placeholders)

```text
Use Webcmd, Profile "travel-agent", to plan a trip: {DESTINATION} from
{ORIGIN}, {START_DATE} to {END_DATE}, budget {BUDGET} {CURRENCY} for
{TRAVELERS} traveler(s).

For each of these four categories, use a separate Webcmd Session
(travel-<destination-slug>-<category>-<platform>) so every tab stays open
side by side:

1. Flights — ixigo Flights (ixigo.com/flights)
2. Trains — ixigo Trains (ixigo.com/trains)
3. Cabs — JustDial (justdial.com), searching for cab/outstation-rental
   operators in {DESTINATION}
4. Hotels — MakeMyTrip (makemytrip.com) AND Goibibo (goibibo.com)

For each platform: start from its homepage, not a guessed URL — bot-check
interstitials were hit on at least one guessed deep link during testing, but
the homepage itself loaded cleanly every time. Use an act-mode snapshot to
find the real search fields on the live page (origin, destination, dates,
travelers) and fill them the way an actual visitor would, adapting to
whatever the page currently shows rather than assuming fixed selectors. Read
the results with a read-mode snapshot and identify one representative price
+ short description for that platform (the cheapest reasonable option is
fine — this is a demo, not real comparison shopping).

Then do a plain Google search for "things to do in {DESTINATION}" and note
5-8 place names/snippets from the results (a Session of its own, or a plain
`web fetch` first if that returns useful text without needing a browser).

Hard rules:
- Read-only. Do not log in, create an account, fill a checkout/payment form,
  or submit anything on any of these sites.
- Do not close any Session or tab you open — leave every one of them open
  when you're done; that's the point (the user's website side opens/uses
  these tabs next).
- If a platform's homepage also looks blocked/dead (CAPTCHA, error, empty),
  say so plainly instead of guessing a price — leave that platform's entry
  with price: null and a short note of what you saw.
- Never enter real payment or personal details anywhere — there's a separate
  dummy checkout page for that, unrelated to this task.

When you're done, report a comparison table in chat (platform / price /
short description / URL, grouped by category), then write the same data as
JSON to travel-agent/output/{TRIP_SLUG}.json in this exact shape (see
src/lib/types.js for the full field list):

{
  "schemaVersion": "1.0.0",
  "generatedAt": "<ISO timestamp>",
  "intent": { "destination": "{DESTINATION}", "origin": "{ORIGIN}", "startDate": "{START_DATE}", "endDate": "{END_DATE}", "budget": {BUDGET}, "currency": "{CURRENCY}", "travelers": {TRAVELERS} },
  "profile": "travel-agent",
  "results": [ { "category": "...", "platform": "...", "url": "...", "sessionId": "...", "pick": { "title": "...", "price": 0, "currency": "INR" } | null, "error": "..." | null } ],
  "places": { "query": "things to do in {DESTINATION}", "shortlist": ["...", "..."] },
  "openTabs": [ { "profile": "travel-agent", "sessionId": "...", "category": "...", "platform": "..." } ]
}
```

## Filled-in example (the trip used for live testing)

```text
Use Webcmd, Profile "travel-agent", to plan a trip: Goa from Mumbai,
2026-10-12 to 2026-10-15, budget 30000 INR for 2 travelers.

For each of these four categories, use a separate Webcmd Session
(travel-goa-<category>-<platform>) so every tab stays open side by side:

1. Flights — Skyscanner (skyscanner.net)
2. Trains — ixigo Trains (ixigo.com/trains)
3. Cabs — JustDial (justdial.com), searching for cab/outstation-rental
   operators in Goa
4. Hotels — MakeMyTrip (makemytrip.com) AND Goibibo (goibibo.com)

[... same "start from the homepage" / hard rules / output format as above ...]
```

## Why a prompt, not just more script

`src/index.js` (the deterministic script) can only do what its hardcoded
URLs and regexes anticipated — live testing on 2026-09-12 immediately found
a case that breaks (Skyscanner's deep link *and* its homepage → a PerimeterX
CAPTCHA, once even mid-interaction) that this prompt handles naturally by
recognizing the block and reporting it honestly instead of guessing a price.
Skyscanner was since dropped from the site list entirely in favor of ixigo
Flights, but the same class of surprise can happen on any site at any
time — that adaptability — not needing to know a site's exact selectors or
URL scheme ahead of time — is the actual point of webcmd, per
`docs/concepts.mdx`: *"You do not need to describe selectors or browser
steps; the agent determines those from the live website."* The script is
still useful (deterministic, no AI cost, good for CI/repeat runs once a
platform's interaction is nailed down) — see README for how the two relate.
