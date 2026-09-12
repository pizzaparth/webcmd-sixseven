// Price comparison page — rendered from a TripData JSON file (see
// ../src/lib/types.js and README "Output schema"). One section per
// category, one card + "Choose <platform>" button per platform, and a
// static "live price" banner up top. Pure function of the data: no I/O here,
// so server.js and build.js can both use it.

import { renderPage, esc, badge, button, DEFAULT_LINKS } from './template.js';

const CATEGORY_ORDER = ['flights', 'trains', 'cabs', 'hotels'];
const CATEGORY_LABEL = { flights: 'Flights', trains: 'Trains', cabs: 'Cabs', hotels: 'Hotels' };
const CONFIDENCE_TONE = { HIGH: 'ok', MEDIUM: 'warn', LOW: 'bad' };

function currencySymbol(code) {
  return code === 'USD' ? '$' : '₹';
}

export function formatPrice(price, currency = 'INR') {
  if (price == null || Number.isNaN(Number(price))) return null;
  return `${currencySymbol(currency)}${Number(price).toLocaleString('en-IN')}`;
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Groups results by category, in the fixed display order (unknown categories last). */
export function groupByCategory(results) {
  const groups = new Map();
  for (const r of results || []) {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category).push(r);
  }
  const ordered = [];
  for (const c of CATEGORY_ORDER) if (groups.has(c)) ordered.push([c, groups.get(c)]);
  for (const [c, rows] of groups) if (!CATEGORY_ORDER.includes(c)) ordered.push([c, rows]);
  return ordered;
}

/** Cheapest priced result in a category, or null if nothing had a price. */
export function cheapest(rows) {
  let best = null;
  for (const r of rows) {
    if (r.pick?.price == null) continue;
    if (!best || r.pick.price < best.pick.price) best = r;
  }
  return best;
}

/**
 * The number behind the "live" banner: sum of the cheapest captured price
 * per category. Computed once from the snapshot — see plan.md, this is not
 * polled. Categories with no captured price are listed so the page can say so.
 */
export function bestTotal(results) {
  const groups = groupByCategory(results);
  let total = 0;
  let currency = 'INR';
  const priced = [];
  const unpriced = [];
  for (const [category, rows] of groups) {
    const best = cheapest(rows);
    if (best) {
      total += best.pick.price;
      currency = best.pick.currency || currency;
      priced.push({ category, platform: best.platform, price: best.pick.price });
    } else {
      unpriced.push(category);
    }
  }
  return { total, currency, priced, unpriced };
}

function tripSummary(intent) {
  const parts = [];
  if (intent?.origin) parts.push(`${intent.origin} → ${intent.destination}`);
  else if (intent?.destination) parts.push(intent.destination);
  const start = formatDate(intent?.startDate);
  const end = formatDate(intent?.endDate);
  if (start && end) parts.push(`${start} – ${end}`);
  else if (start) parts.push(start);
  if (intent?.travelers) parts.push(`${intent.travelers} traveler${intent.travelers === 1 ? '' : 's'}`);
  if (intent?.budget != null) parts.push(`budget ${formatPrice(intent.budget, intent.currency)}`);
  return parts.join(' · ');
}

function renderResultCard(r, { isBest }) {
  const priceText = r.pick ? formatPrice(r.pick.price, r.pick.currency) : null;
  const canOpen = Boolean(r.url) && !r.error;
  const classes = ['card', isBest ? 'best' : ''].filter(Boolean).join(' ');
  const id = `${r.category}:${r.platformId}`;

  const detail = r.error
    ? `<div class="status bad">${esc(r.error)}</div>`
    : r.pick
      ? `<div class="small">${esc(r.pick.title || 'Option found on page')}</div>`
      : `<div class="small muted">${
          r.usedFallbackHomepage
            ? 'No pre-filled search available — the tab is on the platform homepage.'
            : 'Search page opened, but no price could be read from it yet.'
        }</div>`;

  const source = r.usedFallbackHomepage ? 'homepage' : 'deep link';

  return `
  <div class="${classes}" data-card="${esc(id)}">
    <div class="row between">
      <h3>${esc(r.platform)}</h3>
      <div class="row">
        ${isBest ? badge('Best price', 'ok') : ''}
        ${badge(`${r.confidence} confidence`, CONFIDENCE_TONE[r.confidence] || 'neutral')}
      </div>
    </div>
    <div class="price ${priceText ? '' : 'none'}">${priceText ? esc(priceText) : 'Price not captured'}</div>
    ${detail}
    <div class="small muted" style="margin-top:8px">
      Source: ${esc(source)}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">view URL</a>` : ''}
      ${r.candidates?.length > 1 ? ` · ${r.candidates.length} prices seen on page` : ''}
    </div>
    <div style="margin-top:14px">
      ${button(`Choose ${r.platform}`, {
        block: true,
        disabled: !canOpen,
        attrs: `data-choose="${esc(id)}" data-category="${esc(r.category)}" data-platform-id="${esc(r.platformId)}" data-platform="${esc(r.platform)}"`,
      })}
      <div class="status" data-status="${esc(id)}"></div>
    </div>
  </div>`;
}

function renderCategory(category, rows) {
  const best = rows.length > 1 ? cheapest(rows) : null;
  return `
  <section class="section" data-category="${esc(category)}">
    <div class="section-head">
      <h2>${esc(CATEGORY_LABEL[category] || category)}</h2>
      <span class="meta">${rows.length} platform${rows.length === 1 ? '' : 's'} searched · <span data-picked-label="${esc(category)}">no selection yet</span></span>
    </div>
    <div class="grid">
      ${rows.map((r) => renderResultCard(r, { isBest: best ? r === best : false })).join('')}
    </div>
  </section>`;
}

function renderPlaces(places) {
  if (!places) return '';
  return `
  <section class="section">
    <div class="section-head">
      <h2>Places to explore</h2>
      <span class="meta">Google search · <a href="${esc(places.url)}" target="_blank" rel="noopener">open results</a></span>
    </div>
    <div class="card">
      <div class="small muted">Query: <span class="mono">${esc(places.query)}</span></div>
      ${
        places.shortlist?.length
          ? `<ul class="list">${places.shortlist.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
          : `<div class="small muted" style="margin-top:8px">No shortlist captured — use the results tab the agent left open.</div>`
      }
      ${places.error ? `<div class="status bad">${esc(places.error)}</div>` : ''}
    </div>
  </section>`;
}

function renderBanner(trip) {
  const { total, currency, priced, unpriced } = bestTotal(trip.results);
  const generated = trip.generatedAt ? new Date(trip.generatedAt) : null;
  const breakdown = priced.length
    ? priced.map((p) => `${CATEGORY_LABEL[p.category] || p.category}: ${p.platform} ${formatPrice(p.price, currency)}`).join(' · ')
    : 'No prices captured in this run';
  const missing = unpriced.length
    ? ` · not included: ${unpriced.map((c) => CATEGORY_LABEL[c] || c).join(', ')}`
    : '';
  return `
  <div class="banner">
    <div>
      <div class="label">Best total trip price</div>
      <div class="big">${priced.length ? esc(formatPrice(total, currency)) : '—'}</div>
      <div class="small muted">${esc(breakdown)}${esc(missing)}</div>
    </div>
    <div class="right">
      <div class="live"><span class="dot blink"></span> Live price counter</div>
      <div class="small muted">Last updated <span class="mono" data-clock>--:--:--</span></div>
      <div class="small muted">Snapshot from agent run ${generated ? `<span class="mono">${esc(generated.toLocaleString('en-IN'))}</span>` : ''}</div>
    </div>
  </div>`;
}

/**
 * @param {import('../src/lib/types.js').TripData} trip
 * @param {{ mode?: 'server'|'static', sourceLabel?: string }} [options]
 *   mode 'server' → choose buttons POST /api/choose (webcmd opens the tab);
 *   mode 'static' → choose buttons open the URL in a new browser tab directly.
 */
export function renderComparisonPage(trip, { mode = 'server', sourceLabel = '', links = DEFAULT_LINKS } = {}) {
  const groups = groupByCategory(trip.results);
  const summary = tripSummary(trip.intent);
  const resultsById = {};
  for (const r of trip.results || []) resultsById[`${r.category}:${r.platformId}`] = { url: r.url, platform: r.platform, price: r.pick?.price ?? null, currency: r.pick?.currency || 'INR' };

  const body = `
  <h1>Compare &amp; choose</h1>
  <p class="sub">${esc(summary || 'Trip')}${sourceLabel ? ` · <span class="mono">${esc(sourceLabel)}</span>` : ''}</p>
  ${renderBanner(trip)}
  ${sourceLabel.includes('sample') ? `<div class="notice" style="margin-top:12px">Showing bundled sample data — run the agent (<span class="mono">node src/index.js ...</span>) to generate a real trip file.</div>` : ''}
  ${groups.length ? groups.map(([c, rows]) => renderCategory(c, rows)).join('') : '<div class="notice" style="margin-top:20px">No results in this trip file.</div>'}
  ${renderPlaces(trip.places)}

  <section class="section">
    <div class="section-head">
      <h2>Your picks</h2>
      <span class="meta">Selected total: <strong data-picks-total>—</strong></span>
    </div>
    <div class="card">
      <div class="small muted" data-picks-empty>Click "Choose" on a platform above. The agent opens a tab on that exact result — nothing is booked or submitted.</div>
      <ul class="list" data-picks-list></ul>
      <div style="margin-top:14px" class="row">
        <a class="btn" href="${esc(links.checkout)}" data-continue hidden>Continue to details &amp; payment</a>
      </div>
    </div>
  </section>`;

  const script = `
(function () {
  var MODE = ${JSON.stringify(mode)};
  var RESULTS = ${JSON.stringify(resultsById)};
  var picks = {};

  // Ticking "last updated" clock. Cosmetic: the price itself is a snapshot.
  var clock = document.querySelector('[data-clock]');
  function tick() { clock.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false }); }
  tick(); setInterval(tick, 1000);

  function fmt(n, cur) { return (cur === 'USD' ? '$' : '\\u20B9') + Number(n).toLocaleString('en-IN'); }

  function renderPicks() {
    var list = document.querySelector('[data-picks-list]');
    var empty = document.querySelector('[data-picks-empty]');
    var totalEl = document.querySelector('[data-picks-total]');
    var cont = document.querySelector('[data-continue]');
    var keys = Object.keys(picks);
    list.innerHTML = '';
    var total = 0, priced = 0, cur = 'INR';
    keys.forEach(function (cat) {
      var p = picks[cat];
      var li = document.createElement('li');
      li.textContent = cat + ': ' + p.platform + (p.price != null ? ' — ' + fmt(p.price, p.currency) : ' — no price captured');
      list.appendChild(li);
      if (p.price != null) { total += p.price; priced++; cur = p.currency; }
    });
    empty.hidden = keys.length > 0;
    cont.hidden = keys.length === 0;
    totalEl.textContent = priced ? fmt(total, cur) : '—';
    try { sessionStorage.setItem('travel-picks', JSON.stringify(picks)); } catch (e) {}
  }

  function setStatus(id, text, tone) {
    var el = document.querySelector('[data-status="' + id + '"]');
    el.textContent = text; el.className = 'status ' + (tone || '');
  }

  function markSelected(category, id) {
    document.querySelectorAll('[data-category="' + category + '"] [data-card]').forEach(function (card) {
      var isThis = card.getAttribute('data-card') === id;
      card.classList.toggle('selected', isThis);
      var btn = card.querySelector('[data-choose]');
      if (btn.disabled && !btn.dataset.busy) return;
      btn.textContent = (isThis ? 'Selected \\u2014 ' : 'Switch to ') + btn.getAttribute('data-platform');
      btn.classList.toggle('secondary', !isThis);
    });
    var label = document.querySelector('[data-picked-label="' + category + '"]');
    if (label) label.textContent = 'selected: ' + picks[category].platform;
  }

  async function choose(btn) {
    var id = btn.getAttribute('data-choose');
    var category = btn.getAttribute('data-category');
    var platformId = btn.getAttribute('data-platform-id');
    var platform = btn.getAttribute('data-platform');
    var info = RESULTS[id] || {};
    btn.disabled = true; btn.dataset.busy = '1';
    setStatus(id, 'Opening tab\\u2026', '');
    try {
      var opened = false, note = '';
      if (MODE === 'server') {
        var res = await fetch('/api/choose', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: category, platformId: platformId }),
        });
        var data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        opened = data.opened;
        note = data.note || '';
        if (!opened && data.url) { window.open(data.url, '_blank', 'noopener'); opened = true; note = 'Opened in your browser' + (note ? ' (' + note + ')' : '') + '.'; }
      } else if (info.url) {
        window.open(info.url, '_blank', 'noopener'); opened = true; note = 'Opened in your browser.';
      }
      picks[category] = { platform: platform, platformId: platformId, price: info.price, currency: info.currency, url: info.url };
      setStatus(id, opened ? (note || 'Tab opened.') : 'Selected.', 'ok');
      markSelected(category, id);
      renderPicks();
    } catch (err) {
      setStatus(id, 'Could not open: ' + (err && err.message ? err.message : err), 'bad');
    } finally {
      btn.disabled = false; delete btn.dataset.busy;
    }
  }

  document.querySelectorAll('[data-choose]').forEach(function (btn) {
    btn.addEventListener('click', function () { choose(btn); });
  });
  renderPicks();
})();
`;

  return renderPage({
    title: `Compare — ${trip.intent?.destination || 'Trip'}`,
    body,
    script,
    activeNav: 'compare',
    links,
  });
}
