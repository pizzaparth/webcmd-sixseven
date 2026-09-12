// Builds the natural-language task handed to the `claude` CLI (see
// claude-agent.js). This is the executable twin of ../../agent-prompt.md's
// template — keep the wording in sync if you edit one.

function formatDateRange(intent) {
  if (intent.startDate && intent.endDate) return `${intent.startDate} to ${intent.endDate}`;
  if (intent.startDate) return intent.startDate;
  return 'flexible dates';
}

const CATEGORY_LINES = {
  // Skyscanner was here originally; dropped after verified-live testing
  // (2026-09-12) showed its deep link *and* its homepage both trigger a
  // PerimeterX bot-check, once even mid-interaction. ixigo Flights uses the
  // same domain as the trains search below, which never showed a CAPTCHA.
  flights: '1. Flights — ixigo Flights (ixigo.com/flights)',
  trains: '2. Trains — ixigo Trains (ixigo.com/trains)',
  cabs: '3. Cabs — JustDial (justdial.com), searching for cab/outstation-rental operators in {DESTINATION}',
  hotels: '4. Hotels — MakeMyTrip (makemytrip.com) AND Goibibo (goibibo.com)',
};

/**
 * @param {{intent: object, profile: string, tripSlug: string, outputPath: string, skip?: string[]}} args
 * @returns {string} the full prompt to pass to `claude -p`
 */
export function buildAgentPrompt({ intent, profile, tripSlug, outputPath, skip = [] }) {
  const categories = Object.keys(CATEGORY_LINES).filter((c) => !skip.includes(c));
  const categoryList = categories
    .map((c) => CATEGORY_LINES[c].replace('{DESTINATION}', intent.destination))
    .join('\n');
  const doPlaces = !skip.includes('places');

  const budgetLine =
    intent.budget != null ? `budget ${intent.budget} ${intent.currency}` : 'no fixed budget given';

  return `Use Webcmd, Profile "${profile}", to plan a trip: ${intent.destination}${
    intent.origin ? ` from ${intent.origin}` : ''
  }, ${formatDateRange(intent)}, ${budgetLine}, for ${intent.travelers} traveler(s).

First, load the \`webcmd-browser\` skill.

For each of these categories, use a separate Webcmd Session
(travel-${tripSlug}-<category>-<platform>) so every tab stays open side by side:

${categoryList}

For each platform: start from its homepage, not a guessed URL — bot-check
interstitials have been seen on guessed deep links, but the homepage itself
loads cleanly. Use an act-mode snapshot to find the real search fields on
the live page (origin, destination, dates, travelers) and fill them the way
an actual visitor would, adapting to whatever the page currently shows
rather than assuming fixed selectors. Read the results with a read-mode
snapshot and identify one representative price + short description for
that platform (the cheapest reasonable option is fine — this is a demo, not
real comparison shopping).
${
  doPlaces
    ? `\nThen do a plain Google search for "things to do in ${intent.destination}" and note 5-8 place names/snippets from the results (a Session of its own, or a plain \`web fetch\` first if that returns useful text without needing a browser).\n`
    : ''
}
Hard rules:
- Read-only. Do not log in, create an account, fill a checkout/payment form,
  or submit anything on any of these sites.
- Do not close any Session or tab you open — leave every one of them open
  when you're done.
- If a platform's homepage also looks blocked/dead (CAPTCHA, error, empty),
  say so plainly instead of guessing a price — leave that platform's entry
  with price: null and a short note of what you saw.
- Never enter real payment or personal details anywhere.
- Stay within a few Webcmd actions per platform — this is a timeboxed demo,
  not an exhaustive search. If a platform's search form isn't obvious within
  a couple of tries, note that and move on rather than exploring at length.

When you're done, report a comparison table in chat (platform / price /
short description / URL, grouped by category), then write the same data as
JSON to ${outputPath} in this shape (see src/lib/types.js for the full field list):

{
  "schemaVersion": "1.0.0",
  "generatedAt": "<ISO timestamp>",
  "intent": ${JSON.stringify(intent)},
  "profile": "${profile}",
  "results": [ { "category": "...", "platform": "...", "url": "...", "sessionId": "...", "pick": { "title": "...", "price": 0, "currency": "INR" } | null, "error": "..." | null } ],
  "places": ${doPlaces ? `{ "query": "things to do in ${intent.destination}", "shortlist": ["...", "..."] }` : 'null'},
  "openTabs": [ { "profile": "${profile}", "sessionId": "...", "category": "...", "platform": "..." } ]
}`;
}
