# Travel Concierge Agent — Search, Compare, Voice-Fill, Dummy Checkout

> **Status:** the agent (search + open tabs + CLI comparison table +
> `output/<trip>.json`) lives in [`travel-agent/`](travel-agent/README.md).
> The shared dark-theme template, the **price comparison page**, and the
> **combined details + dummy payment page** (with the Web Speech voice
> agent) are built in [`travel-agent/web/`](travel-agent/web/)
> (`node web/server.js`) and read that JSON file. The summary page is not
> yet built.

## The Idea

A CLI-driven browser agent (built on Webcmd) that takes one plain-language
trip description and:

1. Searches a small set of real travel sites per category (flight, train,
   cab, hotel) and pulls back one representative option + price from each.
2. Shows those options on a **price comparison webpage** — one platform per
   button, a static "live price counter" banner up top — and lets the
   **user** click which platform to go with for each category. The agent
   then opens a tab on that exact selected result. No logins, no checkout,
   no form-filling on any of these real sites.
3. Runs a few plain Google searches for **places to visit / things to do**
   in the destination city and opens/lists those results.
4. Finishes with **one combined details-and-payment webpage** — a trip
   details form and a fake Razorpay-style widget together on the same page
   — which the user can either fill by hand or by clicking a **voice agent**
   button that asks the questions out loud and fills the fields for them.
   This page is fully dummy: nothing on it is sent to or filled into any
   real site.

This is a good fit for a webcmd hackathon project: it's a live demo of
browser automation doing real, useful work (search several real sites,
show the user a clean comparison, open exactly the tab they pick) without
needing to defeat logins, CAPTCHAs, or checkouts anywhere — the agent never
goes further than "find it, compare it, show it."

## Hackathon Scope — What This Demo Is / Isn't

- ✅ Real browser automation: search real sites, pull one option + price
  per platform per category.
- ✅ A generated price-comparison page: static "live" price banner, one
  button per platform, user clicks to choose.
- ✅ Opens a tab on the specific result the user picked — still no
  login/checkout/form-filling on the real site itself.
- ✅ Plain Google searches for destination places/activities.
- ✅ One combined details + dummy-payment webpage, built from a single
   reusable dark-theme template.
- ✅ A voice-agent button on that page that asks the questions out loud and
  fills the form for the user.
- ❌ No login, checkout, or form submission happens on any real site.
- ❌ No real purchase, no real payment gateway, nothing sent over the
  network from the details/payment page.
- ❌ No card/PII is ever stored — inputs (typed or voice-filled) live in
  memory for the run only and are discarded when the session ends.
- ❌ The "live" price counter is not actually polling live prices — it's a
  static, pre-fetched number styled to look like a live ticker. Fine for a
  demo, just don't claim it updates in real time.

## Real Sites (as specified)

| Category | Site | Why it fits |
| --- | --- | --- |
| Flights | Skyscanner | Search-and-compare engine; results browsable with no login/CAPTCHA for a normal search. |
| Trains | A CAPTCHA-free train search site — recommend **ixigo Trains** (alternatives: ConfirmTkt, Trainman) rather than IRCTC directly, since IRCTC's own site is the one with the aggressive CAPTCHA + login wall. | Same schedule/availability data as IRCTC, browsable without CAPTCHA. |
| Cabs | JustDial | Local directory search for cab/rental operators in the destination city. "Selection" here means picking a listing (e.g. top-rated local operator) rather than a locked fare, which is fine since no booking is completed anyway. |
| Hotels | MakeMyTrip and/or Goibibo | Standard OTA hotel search by destination/dates/budget; results browsable pre-login. |
| Places to explore | Google Search ("things to do in `<city>`", "places to visit in `<city>`") | Plain search results are enough to open a tab or build a shortlist. |

Bot-detection/CAPTCHA risk stays low here since the agent never logs in,
fills a form, or reaches a checkout page on any of these — it only searches
and reads back results.

## User Flow

1. **Input** — user runs the CLI and describes the trip in plain language:
   destination, dates, budget, number of travelers, preferences.
2. **Search** — for each category (flight, train, cab, hotel), the agent
   searches the corresponding real site and captures one representative
   option + price.
3. **Compare & choose** — the agent generates the price-comparison page
   (see below). The user clicks a platform button per category; the agent
   opens a tab on that exact selected result.
4. **Explore** — the agent runs Google searches for places to visit/things
   to do in the destination city and opens a tab (or builds a short list)
   from the results.
5. **Details + dummy payment** — a single combined page (same shared
   template) presents the trip-details form and the dummy Razorpay-style
   widget together. The user fills it by hand, or taps the voice-agent
   button and answers spoken questions instead.
6. **Summary** — a results page lists every tab opened (flight, train, cab,
   hotel, places), with links, plus the dummy checkout's fake confirmation.

## Price Comparison Page

- One row/card per category (flight, train, cab, hotel), each showing the
  platform name, the option found, and its price.
- A **static "live price counter" banner** at the top (e.g. "Best total
  trip price: ₹X") — styled to look like a live ticker (a ticking
  "last updated" timestamp is a nice touch) but the underlying number is
  fixed, computed once from the search results. No real polling.
- A **button per platform** ("Choose Skyscanner", "Choose ixigo Trains",
  etc.) — clicking it is the user's actual selection; the agent then opens
  a tab on that specific result.
- Built from the same shared template as the details/payment page (see
  Design Template below), so the whole flow feels like one product, not a
  chain of ad hoc pages.

## Details + Dummy Payment Page (combined)

- One page, not two: the trip-details form (traveler name/contact, number
  of travelers, etc.) and the dummy Razorpay-style payment widget (card
  number / expiry / CVV / name, or a UPI field) live together on the same
  screen.
- Entirely local — no SDK, no network call, no real payment gateway. On
  "Pay," it just shows a fake "confirmed" state.
- All inputs should be obviously-fake test values — never anything
  resembling a real card/PAN — and say so out loud during the demo.
- Nothing is persisted to disk; everything lives in memory for the run and
  is discarded when the session ends.

### Voice agent button

- A button on this page activates a voice Q&A flow: the agent asks the
  required fields one at a time out loud, listens for the spoken answer,
  and fills the matching field — visually highlighting whichever field is
  currently being filled.
- **Recommended implementation:** the browser's built-in Web Speech API
  (`SpeechSynthesis` for asking, `SpeechRecognition` for listening) — zero
  backend, zero API keys, works entirely client-side, which fits the
  "everything here is local and dummy" theme of the rest of the project.
  Only reach for an external speech API if Web Speech's accuracy proves too
  unreliable in testing.
- Always leave the fields editable by hand afterward — voice recognition
  will occasionally mishear something (dates, names), so a quick manual
  correction pass should stay available rather than being voice-only.

## Design Template (use everywhere: comparison page, details+payment page, summary page)

Build one shared template/component set and reuse it for every generated
page, rather than styling each page separately:

- **Dark theme** throughout — dark background, light text.
- **No gradients** anywhere.
- **No translucent "pill" badges** — the common rounded, frosted-glass
  badge look is explicitly out.
- **No same-color-on-same-color text** — every piece of text needs real
  contrast against its background/badge color; don't let a badge's text
  match its own background or border hue.
- Otherwise keep it simple: flat solid colors, one accent color used
  consistently for buttons/links, consistent spacing and typography across
  all pages so the comparison page, the details+payment page, and the
  summary page clearly look like one product.

## Architecture Sketch

| Component | Responsibility |
| --- | --- |
| CLI entry point | Parses the free-text trip description into structured intent (destination, dates, budget, travelers, preferences). |
| Orchestrator agent (webcmd) | Searches each category's real site, captures one option + price per platform, and — once the user picks — opens a tab on that exact result. |
| Places explorer | Runs Google searches for the destination city and opens/lists the results. |
| Comparison page | Shared-template page: static live-price banner + one "choose this platform" button per category/option. |
| Details + payment page | Shared-template page combining the trip-details form and the dummy Razorpay widget; hosts the voice-agent button. |
| Voice agent module | Web Speech API-based Q&A flow that asks questions and fills the details+payment form. |
| Summary/log page | Shared-template page listing every tab opened across all categories (with links) plus the dummy checkout's fake confirmation. |

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A site rate-limits or shows a CAPTCHA after several automated searches in quick succession | Pace requests; rehearse the exact demo run ahead of time on the same network/session to catch this before it happens live. |
| "Live" price counter looks obviously fake or gets called out as misleading | Keep the framing honest — a ticking "last updated" clock is fine, but don't claim real-time polling; be ready to say plainly it's a snapshot if asked. |
| Voice recognition mishears an answer (names, dates are the usual culprits) | Always show/allow manual text correction after voice-fill; test the voice flow in the actual demo room's ambient noise beforehand. |
| Judges assume real card data or a real booking is involved | State clearly, on-screen and out loud, that the payment step is a standalone dummy widget disconnected from the real-site tabs. |
| One of the five sites changes layout or is briefly down on demo day | Keep a screen-recorded backup of the full flow; categories are independent, so one failing doesn't block the rest. |
| Pages drift visually inconsistent as more get built | Build the shared template/component set first, and have every page consume it rather than writing one-off CSS per page. |

## Suggested Milestones (timebox to your hackathon clock)

1. Shared dark-theme template/component set (no gradients, no translucent
   pills, guaranteed text contrast) — build this before any individual page.
2. CLI → structured trip-intent parsing.
3. Webcmd-driven search for one category end to end (prove the pattern
   once, e.g. Skyscanner flights), then repeat for trains, cabs, hotels.
4. Price comparison page: static live-price banner + per-platform choose
   buttons, wired to actually open the picked result's tab.
5. Google-search places-to-explore step.
6. Combined details + dummy-payment page.
7. Voice-agent Q&A flow filling that page.
8. Summary/log page tying all opened tabs + the dummy confirmation
   together.
9. Stretch: swap in a second site per category as a fallback/alternative,
   or extend the comparison page to show more than one option per platform.
