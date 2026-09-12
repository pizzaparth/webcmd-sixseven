// Price comparison page — rendered from a TripData JSON file (see
// ../src/lib/types.js and README "Output schema"). One section per
// category, one card + "Choose <platform>" button per platform, and a
// static "live price" banner up top. Pure function of the data: no I/O here,
// so server.js and build.js can both use it.

import { renderPage, esc, badge, button, jsonScript, DEFAULT_LINKS } from './template.js';

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
/**
 * `trips` (server mode): [{name, isSample, current}] for the trip switcher.
 * `search` (server mode): { available, mode, job } — whether the site can
 * start a new agent run, and the state of the current/last run.
 */
export function renderComparisonPage(trip, { mode = 'server', sourceLabel = '', links = DEFAULT_LINKS, trips = [], search = null } = {}) {
  const groups = groupByCategory(trip.results);
  const summary = tripSummary(trip.intent);
  const resultsById = {};
  for (const r of trip.results || []) resultsById[`${r.category}:${r.platformId}`] = { url: r.url, platform: r.platform, price: r.pick?.price ?? null, currency: r.pick?.currency || 'INR' };

  const job = search?.job || { state: 'idle' };
  const searchPanel =
    mode === 'server'
      ? `
  <section class="card" style="margin-top:16px" data-search-panel>
    <div class="row between">
      <div class="row">
        <h2>New search</h2>
        ${search?.available ? badge(`agent: ${search.mode}`, 'info') : badge('agent unavailable', 'bad')}
      </div>
      <div class="row">
        ${trips.length > 1 ? `<label class="small muted" for="tripSelect">Trip file</label>
        <select id="tripSelect" data-trip-select style="width:auto">${trips.map((t) => `<option value="${esc(t.name)}" ${t.current ? 'selected' : ''}>${esc(t.name)}${t.isSample ? ' (sample)' : ''}</option>`).join('')}</select>` : ''}
        ${button('Show form', { secondary: true, attrs: 'data-search-toggle' })}
      </div>
    </div>
    <div data-search-form hidden style="margin-top:12px">
      ${
        search?.available
          ? ''
          : '<div class="notice" style="margin-bottom:12px">No search engine on this machine — install <span class="mono">webcmd</span> (and the <span class="mono">claude</span> CLI for the adaptive agent), or run <span class="mono">node src/index.js …</span> from a terminal and pick the new file above.</div>'
      }
      <div class="field">
        <label for="searchText">Describe the trip</label>
        <input id="searchText" placeholder='Trip to Goa from Mumbai, 12 Oct to 15 Oct, 2 travelers, budget 30000' value="${esc(trip.intent?.raw || '')}">
      </div>
      <div class="form-grid" style="margin-top:10px">
        <div class="field"><label for="sFrom">From</label><input id="sFrom" placeholder="Mumbai" value="${esc(trip.intent?.origin || '')}"></div>
        <div class="field"><label for="sTo">To</label><input id="sTo" placeholder="Goa" value="${esc(trip.intent?.destination || '')}"></div>
        <div class="field"><label for="sStart">Start date</label><input id="sStart" type="date" value="${esc(trip.intent?.startDate || '')}"></div>
        <div class="field"><label for="sEnd">End date</label><input id="sEnd" type="date" value="${esc(trip.intent?.endDate || '')}"></div>
        <div class="field"><label for="sTravelers">Travelers</label><input id="sTravelers" type="number" min="1" max="20" value="${esc(trip.intent?.travelers || 1)}"></div>
        <div class="field"><label for="sBudget">Budget (₹)</label><input id="sBudget" type="number" min="0" value="${esc(trip.intent?.budget ?? '')}"></div>
      </div>
      <div class="row" style="margin-top:12px">
        ${button('Search real sites', { attrs: 'data-search-start', disabled: !search?.available })}
        ${button('Stop search', { secondary: true, attrs: 'data-search-stop hidden' })}
        <span class="small muted">Runs the agent (a few minutes). Explicit fields win over the description.</span>
      </div>
      <div class="status" data-search-status></div>
      <div class="log" data-search-log hidden></div>
    </div>
  </section>`
      : '';

  const body = `
  <h1>Compare &amp; choose</h1>
  <p class="sub">${esc(summary || 'Trip')}${sourceLabel ? ` · <span class="mono">${esc(sourceLabel)}</span>` : ''}</p>
  ${renderBanner(trip)}
  ${searchPanel}
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
        <span class="small" data-autogo hidden></span>
        ${button('Stay here', { secondary: true, attrs: 'data-autogo-cancel hidden' })}
      </div>
    </div>
  </section>`;

  const script = `
(function () {
  var MODE = ${jsonScript(mode)};
  var RESULTS = ${jsonScript(resultsById)};
  var CHECKOUT_URL = ${jsonScript(links.checkout)};
  // Every category this trip actually has a result for. Auto-advance waits for
  // all of them so picking flights doesn't skip past the hotel choice.
  var CATEGORIES = ${jsonScript(groups.map(([category]) => category))};
  var AUTO_ADVANCE_SECONDS = 5;
  var picks = {};
  var autoTimer = null;
  var autoCancelled = false;

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
    maybeAutoAdvance();
  }

  function everyCategoryPicked() {
    return CATEGORIES.length > 0 && CATEGORIES.every(function (c) { return picks[c]; });
  }

  function stopAutoAdvance() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    document.querySelector('[data-autogo]').hidden = true;
    document.querySelector('[data-autogo-cancel]').hidden = true;
  }

  /** Once every category has a pick, head to the details page on its own. */
  function maybeAutoAdvance() {
    if (autoCancelled || !everyCategoryPicked()) return;
    // Restart on every pick, so switching platforms mid-countdown doesn't
    // navigate away while the user is still choosing.
    stopAutoAdvance();
    var note = document.querySelector('[data-autogo]');
    var cancel = document.querySelector('[data-autogo-cancel]');
    var left = AUTO_ADVANCE_SECONDS;
    note.hidden = false;
    cancel.hidden = false;
    note.textContent = 'All set — opening details & payment in ' + left + 's…';
    autoTimer = setInterval(function () {
      left--;
      if (left > 0) {
        note.textContent = 'All set — opening details & payment in ' + left + 's…';
        return;
      }
      stopAutoAdvance();
      window.location.href = CHECKOUT_URL;
    }, 1000);
  }

  document.querySelector('[data-autogo-cancel]').addEventListener('click', function () {
    // Deliberate opt-out: don't re-arm on later picks, or it fights the user.
    autoCancelled = true;
    stopAutoAdvance();
  });

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

  // ---- new search / trip switcher (server mode only) --------------------
  var INITIAL_JOB = ${jsonScript(job)};
  var panel = document.querySelector('[data-search-panel]');
  if (panel) {
    var form = panel.querySelector('[data-search-form]');
    var toggle = panel.querySelector('[data-search-toggle]');
    var statusEl = panel.querySelector('[data-search-status]');
    var logEl = panel.querySelector('[data-search-log]');
    var startBtn = panel.querySelector('[data-search-start]');
    var stopBtn = panel.querySelector('[data-search-stop]');
    stopBtn.addEventListener('click', async function () {
      stopBtn.disabled = true;
      try { await fetch('/api/search/stop', { method: 'POST' }); } catch (e) {}
      stopBtn.disabled = false;
    });
    function showForm(show) { form.hidden = !show; toggle.textContent = show ? 'Hide form' : 'Show form'; }
    toggle.addEventListener('click', function () { showForm(form.hidden); });

    var sel = panel.querySelector('[data-trip-select]');
    if (sel) sel.addEventListener('change', function () { window.location.href = '/?trip=' + encodeURIComponent(sel.value); });

    var polling = null;
    function renderJob(j) {
      if (!j || j.state === 'idle') { statusEl.textContent = ''; statusEl.className = 'status'; logEl.hidden = true; return; }
      logEl.hidden = false;
      logEl.textContent = (j.log || []).join('\\n');
      logEl.scrollTop = logEl.scrollHeight;
      stopBtn.hidden = j.state !== 'running';
      if (j.state === 'running') {
        statusEl.className = 'status';
        statusEl.textContent = 'Searching ' + (j.intent && j.intent.destination ? j.intent.destination : '') + ' with the ' + j.mode + ' agent\u2026 started ' + new Date(j.startedAt).toLocaleTimeString();
        startBtn.disabled = true;
      } else if (j.state === 'done') {
        statusEl.className = 'status ok';
        statusEl.textContent = 'Search finished \u2014 loading results\u2026';
        if (polling) { clearInterval(polling); polling = null; }
        if (INITIAL_JOB.state === 'running' || startBtn.dataset.started) setTimeout(function () { window.location.href = '/'; }, 800);
        else startBtn.disabled = false;
      } else if (j.state === 'error') {
        statusEl.className = 'status bad';
        statusEl.textContent = 'Search failed: ' + (j.error || 'unknown error');
        if (polling) { clearInterval(polling); polling = null; }
        startBtn.disabled = false;
      }
    }
    async function poll() {
      try {
        var res = await fetch('/api/search/status');
        var data = await res.json();
        renderJob(data.job);
      } catch (e) { /* server restarting? keep trying */ }
    }
    function startPolling() { if (!polling) polling = setInterval(poll, 2500); }

    if (INITIAL_JOB.state === 'running') { showForm(true); renderJob(INITIAL_JOB); startPolling(); }
    else if (INITIAL_JOB.state === 'error') { showForm(true); renderJob(INITIAL_JOB); }

    startBtn.addEventListener('click', async function () {
      var body = {
        text: document.getElementById('searchText').value.trim(),
        origin: document.getElementById('sFrom').value.trim(),
        destination: document.getElementById('sTo').value.trim(),
        startDate: document.getElementById('sStart').value,
        endDate: document.getElementById('sEnd').value,
        travelers: document.getElementById('sTravelers').value,
        budget: document.getElementById('sBudget').value,
      };
      if (!body.text && !body.destination) { statusEl.className = 'status bad'; statusEl.textContent = 'Give a destination or a description.'; return; }
      // Explicit fields win: send text only when no destination was typed.
      if (body.destination) delete body.text;
      startBtn.disabled = true; startBtn.dataset.started = '1';
      statusEl.className = 'status'; statusEl.textContent = 'Starting\u2026';
      try {
        var res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        var data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        renderJob(data.job); startPolling();
      } catch (err) {
        statusEl.className = 'status bad'; statusEl.textContent = 'Could not start: ' + err.message; startBtn.disabled = false;
      }
    });
  }
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
