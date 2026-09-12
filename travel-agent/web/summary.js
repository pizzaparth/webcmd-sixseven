// Summary / log page (plan.md → "Summary"): every tab the run opened —
// the agent's search Sessions per category, the extra Session opened for
// each platform the user chose, and the places search — with links, plus
// the dummy checkout's fake confirmation. Same shared template as the other
// two pages.

import { renderPage, esc, badge, DEFAULT_LINKS } from './template.js';
import { formatPrice } from './compare.js';

const CATEGORY_LABEL = { flights: 'Flights', trains: 'Trains', cabs: 'Cabs', hotels: 'Hotels', places: 'Places' };
const CATEGORY_ORDER = ['flights', 'trains', 'cabs', 'hotels', 'places'];

function label(category) {
  return CATEGORY_LABEL[category] || category;
}

function sortByCategory(rows) {
  const rank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  return [...rows].sort((a, b) => rank(a.category) - rank(b.category));
}

/**
 * @param {import('../src/lib/types.js').TripData} trip
 * @param {{ mode?: 'server'|'static', picks?: Record<string, object>, confirmation?: object|null, links?: object }} [options]
 *   In server mode `picks`/`confirmation` come from the server's memory; in
 *   static mode the page reads them from sessionStorage on load instead.
 */
export function renderSummaryPage(trip, { mode = 'server', picks = {}, confirmation = null, links = DEFAULT_LINKS } = {}) {
  const intent = trip.intent || {};
  const route = intent.origin ? `${intent.origin} → ${intent.destination}` : intent.destination || 'Trip';
  const byKey = new Map((trip.results || []).map((r) => [`${r.category}:${r.platformId}`, r]));

  // Tabs the agent left open during the search run (one Session per platform).
  const searchTabs = sortByCategory(trip.openTabs || []).map((t) => {
    const result = [...byKey.values()].find((r) => r.sessionId === t.sessionId);
    const url = result?.url || (t.category === 'places' ? trip.places?.url : null);
    return { ...t, url, price: result?.pick?.price ?? null, currency: result?.pick?.currency || 'INR' };
  });

  const tabRow = (t, extra = '') => `
    <tr>
      <td>${esc(label(t.category))}</td>
      <td>${esc(t.platform)}${extra}</td>
      <td>${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">open</a>` : '<span class="muted">—</span>'}</td>
      <td class="mono small">${esc(t.sessionId || '—')}</td>
    </tr>`;

  const body = `
  <h1>Trip summary</h1>
  <p class="sub">${esc(route)} · everything this run opened, and the dummy checkout result.</p>

  <section class="section">
    <div class="section-head">
      <h2>Your picks</h2>
      <span class="meta">Chosen on the comparison page · total <strong data-picks-total>—</strong></span>
    </div>
    <div class="card">
      <div class="small muted" data-picks-empty>No platforms chosen yet — <a href="${esc(links.compare)}">go to compare</a>.</div>
      <div class="table-wrap" data-picks-table hidden>
        <table>
          <thead><tr><th>Category</th><th>Platform</th><th>Price</th><th>Tab</th><th>Session</th></tr></thead>
          <tbody data-picks-body></tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-head">
      <h2>Dummy payment</h2>
      <span class="meta" data-confirm-meta></span>
    </div>
    <div class="card" data-confirm-card>
      <div class="small muted" data-confirm-empty>No dummy payment yet — <a href="${esc(links.checkout)}">go to details &amp; payment</a>.</div>
      <dl class="kv" data-confirm-body hidden></dl>
    </div>
  </section>

  <section class="section">
    <div class="section-head">
      <h2>Tabs opened by the search run</h2>
      <span class="meta">${searchTabs.length} session${searchTabs.length === 1 ? '' : 's'} · left open on purpose</span>
    </div>
    <div class="card">
      ${
        searchTabs.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Category</th><th>Platform</th><th>Tab</th><th>webcmd session</th></tr></thead>
              <tbody>${searchTabs.map((t) => tabRow(t, t.price != null ? ` <span class="muted small">· ${esc(formatPrice(t.price, t.currency))}</span>` : '')).join('')}</tbody>
            </table></div>`
          : '<div class="small muted">No sessions recorded in this trip file (dry run?).</div>'
      }
      <div class="small muted" style="margin-top:10px">
        Re-inspect any of these with <span class="mono">webcmd --profile ${esc(trip.profile || 'travel-agent')} --session &lt;session&gt; browser tabs</span>.
        Nothing was logged in to, submitted, or paid for on any of them.
      </div>
    </div>
  </section>

  ${
    trip.places
      ? `<section class="section">
          <div class="section-head"><h2>Places to explore</h2><span class="meta"><a href="${esc(trip.places.url)}" target="_blank" rel="noopener">open search</a></span></div>
          <div class="card">
            <div class="small muted">Query: <span class="mono">${esc(trip.places.query)}</span></div>
            ${trip.places.shortlist?.length ? `<ul class="list">${trip.places.shortlist.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          </div>
        </section>`
      : ''
  }

  <section class="section">
    <div class="row">
      <a class="btn secondary" href="${esc(links.compare)}">Back to compare</a>
      <a class="btn secondary" href="${esc(links.checkout)}">Details &amp; payment</a>
    </div>
  </section>`;

  const script = `
(function () {
  var SERVER_PICKS = ${JSON.stringify(picks || {})};
  var SERVER_CONFIRMATION = ${JSON.stringify(confirmation || null)};
  var LABELS = ${JSON.stringify(CATEGORY_LABEL)};
  function $(s) { return document.querySelector(s); }
  function fmt(n, cur) { return (cur === 'USD' ? '$' : '\\u20B9') + Number(n).toLocaleString('en-IN'); }
  function read(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { return null; } }

  var picks = Object.keys(SERVER_PICKS).length ? SERVER_PICKS : (read('travel-picks') || {});
  var keys = Object.keys(picks);
  if (keys.length) {
    var body = $('[data-picks-body]'), total = 0, priced = 0, cur = 'INR';
    keys.forEach(function (cat) {
      var p = picks[cat], tr = document.createElement('tr');
      function td(html) { var c = document.createElement('td'); c.innerHTML = html; tr.appendChild(c); }
      td(LABELS[cat] || cat); td(p.platform);
      td(p.price != null ? fmt(p.price, p.currency) : '<span class="muted">not captured</span>');
      td(p.url ? '<a href="' + p.url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">open</a>' : '—');
      td('<span class="mono small">' + (p.sessionId || 'opened in browser') + '</span>');
      body.appendChild(tr);
      if (p.price != null) { total += Number(p.price); priced++; cur = p.currency || cur; }
    });
    $('[data-picks-empty]').hidden = true; $('[data-picks-table]').hidden = false;
    $('[data-picks-total]').textContent = priced ? fmt(total, cur) : '—';
  }

  var c = SERVER_CONFIRMATION || read('travel-confirmation');
  if (c) {
    var dl = $('[data-confirm-body]');
    [['Payment id', c.paymentId], ['Order id', c.orderId], ['Amount', fmt(c.amount, c.currency)], ['Method', c.method],
     ['Traveler', c.traveler + ' (' + c.travelers + ' traveler' + (c.travelers === 1 ? '' : 's') + ')'],
     ['Trip', c.destination + (c.startDate ? ', ' + c.startDate + (c.endDate ? ' \\u2013 ' + c.endDate : '') : '')],
     ['Confirmed at', new Date(c.confirmedAt).toLocaleString('en-IN')],
     ['Status', 'DUMMY \\u2014 no real payment was made']].forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    $('[data-confirm-empty]').hidden = true; dl.hidden = false;
    $('[data-confirm-card]').classList.add('confirm');
    $('[data-confirm-meta]').innerHTML = '<span class="badge ok">Fake confirmation</span>';
  }
})();
`;

  return renderPage({
    title: `Summary — ${intent.destination || 'Trip'}`,
    body,
    script,
    activeNav: 'summary',
    links,
  });
}
