# Travel Concierge Agent — One Prompt, Curated Tabs, One Dummy Checkout

## The Idea

A CLI-driven browser agent (built on Webcmd) that takes one plain-language
trip description and:

1. Searches a small set of real travel sites and opens a tab on the
   **specific selected result** for each of flight, train, cab, and hotel —
   no logins, no checkout, no form-filling on any of these real sites.
2. Runs a few plain Google searches for **places to visit / things to do**
   in the destination city and opens/lists those results.
3. Finishes with **one separate, fully dummy** "trip details + payment"
   page (a fake Razorpay-style widget) — this is the only place any
   name/contact/card data is entered, and it is never sent to or filled
   into any real site.

This is a good fit for a webcmd hackathon project: it's a live demonstration
of browser automation doing real, useful work (search → pick → open the
right tab, across several different real sites) without needing to defeat
logins, CAPTCHAs, or multi-step checkouts on any of them — because the demo
never asks the agent to go further than "find it and show it to me."

## Hackathon Scope — What This Demo Is / Isn't

- ✅ Real browser automation: search real sites, pick a matching result per
  category, open a tab on that exact result.
- ✅ Plain Google searches for destination places/activities, surfaced as
  tabs or a shortlist.
- ✅ One standalone dummy "trip details + payment" page (fake Razorpay-style
  widget) as the closing step of the demo.
- ❌ No login, checkout, or form-filling happens on any real site — the
  agent only searches and selects, it never submits anything to Skyscanner,
  a train site, JustDial, MakeMyTrip, or Goibibo.
- ❌ No real purchase, no real payment gateway, no data sent over the
  network from the dummy page.
- ❌ No card/PII is ever stored — the dummy page's inputs live in memory for
  the run only and are discarded when the session ends.
- ❌ Not attempting open-ended price-optimization across the web — pick one
  real site per category (below) and a simple "good enough" selection rule
  (e.g. cheapest within budget), rather than exhaustive comparison shopping.

## Real Sites (as specified)

| Category | Site | Why it fits |
| --- | --- | --- |
| Flights | Skyscanner | Search-and-compare engine; results are browsable with no login/CAPTCHA for a normal search. |
| Trains | A CAPTCHA-free train search site — recommend **ixigo Trains** (alternatives: ConfirmTkt, Trainman) rather than IRCTC directly, since IRCTC's own site is the one with the aggressive CAPTCHA + login wall. | Same schedule/availability data as IRCTC, browsable without CAPTCHA. |
| Cabs | JustDial | Local directory search for cab/rental operators in the destination city. Note: JustDial lists providers rather than locking a fare, so "selection" here means picking a listing (e.g. top-rated local operator), which is fine since no booking is completed anyway. |
| Hotels | MakeMyTrip and/or Goibibo | Standard OTA hotel search by destination/dates/budget; results browsable pre-login. |
| Places to explore | Google Search ("things to do in `<city>`", "places to visit in `<city>`") | No dedicated site needed — plain search results are enough to open a tab or build a shortlist. |

Since the agent never needs to log in, fill a form, or reach a checkout
page on any of these, bot-detection/CAPTCHA risk is much lower than a
full-booking-automation demo — the only real risk is an unusual volume of
automated-looking searches in a short window triggering a rate limit, which
pacing the requests during rehearsal should catch ahead of time.

## User Flow

1. **Input** — user runs the CLI and describes the trip in plain language:
   destination, dates, budget, number of travelers, preferences.
2. **Search & select** — for each category (flight, train, cab, hotel), the
   agent searches the corresponding real site using the parsed trip intent,
   applies a simple selection rule (e.g. cheapest option within budget, or
   top-rated listing), and opens a tab on that specific selected result.
3. **Explore** — the agent runs a couple of Google searches for places to
   visit / things to do in the destination city and opens a tab (or builds
   a short list) from the results.
4. **Dummy checkout** — a separate generated page presents a simple trip
   details form (traveler name/contact) plus a dummy Razorpay-style payment
   widget. Filling and "paying" here is purely for demo effect; nothing on
   this page is connected to the real-site tabs opened in step 2–3.
5. **Summary** — the agent shows a results page: every tab it opened
   (flight, train, cab, hotel, places), with links, plus confirmation that
   the dummy checkout step completed.

## Architecture Sketch

| Component | Responsibility |
| --- | --- |
| CLI entry point | Parses the free-text trip description into structured intent (destination, dates, budget, travelers, preferences). |
| Orchestrator agent (webcmd) | For each category, searches the chosen real site with the parsed intent, applies the selection rule, and opens a tab on the selected result. |
| Places explorer | Runs Google searches for the destination city and opens/lists the results. |
| Dummy checkout page | Standalone generated page with a trip-details form + dummy Razorpay widget; entirely self-contained, not wired to any real site. |
| Summary/log page | Lists every tab opened across all categories (with links) plus the dummy checkout's fake confirmation. |

## The Dummy Razorpay Interface

- Visually mimics a Razorpay checkout (card number / expiry / CVV / name, or
  a UPI ID field) but is entirely local — no SDK, no network call, no real
  payment gateway involved.
- On "Pay," it just shows a fake "confirmed" state and hands nothing to any
  external system — it's the closing beat of the demo, not a data source
  for anything else.
- All inputs should be obviously-fake test values — never anything
  resembling a real card/PAN — and say so out loud during the demo so
  judges don't mistake it for a real transaction.
- Nothing is persisted to disk. Everything lives in memory for the run and
  is discarded when the session ends.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A site rate-limits or shows a CAPTCHA after several automated searches in quick succession | Pace requests; rehearse the exact demo run ahead of time on the same network/session to catch this before it happens live. |
| Selection rule picks an irrelevant/odd result (e.g. cheapest flight is a multi-day layover) | Keep the rule simple but sane (cheapest within budget, filtered to direct/reasonable options first); sanity-check on a few real queries while building. |
| Judges assume real card data or a real booking is involved | State clearly, on-screen and out loud, that the payment step is a standalone dummy widget disconnected from the real-site tabs. |
| One of the five sites changes layout or is briefly down on demo day | Keep a screen-recorded backup of the full flow; the categories are independent, so one failing doesn't block the rest of the demo. |

## Suggested Milestones (timebox to your hackathon clock)

1. CLI → structured trip-intent parsing (destination, dates, budget,
   travelers, preferences).
2. Webcmd-driven search + tab-open for one category end to end (prove the
   pattern once, e.g. Skyscanner flights).
3. Repeat the pattern for trains (ixigo Trains), cabs (JustDial), hotels
   (MakeMyTrip/Goibibo).
4. Google-search places-to-explore step.
5. Dummy Razorpay checkout page.
6. Summary/log page tying all opened tabs + the dummy confirmation
   together.
7. Stretch: swap in a second site per category as a fallback/alternative,
   or add a basic budget-aware comparison across two flight/hotel options
   instead of picking just one.
