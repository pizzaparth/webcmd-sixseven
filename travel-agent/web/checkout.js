// Combined details + dummy payment page (plan.md → "Details + Dummy Payment
// Page"). One screen: trip-details form on the left, a Razorpay-style
// payment widget on the right, and a voice-agent button that asks the
// questions out loud and fills the fields (Web Speech API, client-side only).
//
// Everything on this page is local and fake: no SDK, no gateway, no network
// call except (server mode) a POST of the *non-sensitive* confirmation
// summary to the local server's memory so the summary page can show it.
// Card/UPI fields never leave the browser tab.

import { renderPage, esc, button, DEFAULT_LINKS } from './template.js';
import { formatPrice, bestTotal } from './compare.js';

const CATEGORY_LABEL = { flights: 'Flights', trains: 'Trains', cabs: 'Cabs', hotels: 'Hotels' };

// Obviously-fake test values the "Fill test values" button uses (and the
// demo should say out loud are fake). 4111… is the classic sandbox card.
const TEST_VALUES = {
  name: 'Test Traveler',
  email: 'test.traveler@example.com',
  phone: '9999999999',
  cardName: 'TEST TRAVELER',
  cardNumber: '4111 1111 1111 1111',
  expiry: '12/30',
  cvv: '123',
  upi: 'test@demo',
};

function field({ id, label, type = 'text', placeholder = '', value = '', span2 = false, attrs = '' }) {
  return `
  <div class="field ${span2 ? 'span2' : ''}" data-field="${esc(id)}">
    <label for="${esc(id)}">${esc(label)}</label>
    <input id="${esc(id)}" name="${esc(id)}" type="${esc(type)}" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" ${attrs}>
  </div>`;
}

/**
 * @param {import('../src/lib/types.js').TripData} trip
 * @param {{ mode?: 'server'|'static', picks?: Record<string, object>, links?: object }} [options]
 *   `picks` (server mode) is the in-memory selection map from the comparison
 *   page; in static mode the page reads the same thing from sessionStorage.
 */
export function renderCheckoutPage(trip, { mode = 'server', picks = {}, links = DEFAULT_LINKS } = {}) {
  const intent = trip.intent || {};
  const fallbackTotal = bestTotal(trip.results || []);
  const currency = fallbackTotal.currency || intent.currency || 'INR';
  const route = intent.origin ? `${intent.origin} → ${intent.destination}` : intent.destination || 'Trip';

  const body = `
  <h1>Trip details &amp; payment</h1>
  <p class="sub">${esc(route)} · This is a dummy checkout: nothing here is sent to any real site or gateway.</p>

  <div class="notice">
    <strong>Demo only.</strong> Use obviously-fake test values (the "Fill test values" button has some).
    Inputs live in this tab for the run and are discarded when it closes — no card or personal data is stored anywhere.
  </div>

  <div class="two-col" style="margin-top:16px" data-checkout>
    <section class="card">
      <div class="row between" style="margin-bottom:12px">
        <h2>Trip details</h2>
        <div class="row">
          ${button('Fill test values', { secondary: true, attrs: 'data-fill-test' })}
          ${button('🎤 Voice fill', { attrs: 'data-voice-start' })}
        </div>
      </div>
      <div class="notice" data-voice-panel hidden>
        <div class="row between">
          <span data-voice-status>Voice agent idle.</span>
          ${button('Stop', { secondary: true, attrs: 'data-voice-stop' })}
        </div>
        <div class="log" data-voice-log></div>
      </div>
      <div class="form-grid" style="margin-top:12px">
        ${field({ id: 'name', label: 'Traveler name', placeholder: 'Test Traveler', span2: true })}
        ${field({ id: 'email', label: 'Email', type: 'email', placeholder: 'test@example.com' })}
        ${field({ id: 'phone', label: 'Phone', type: 'tel', placeholder: '9999999999', attrs: 'inputmode="numeric"' })}
        ${field({ id: 'travelers', label: 'Number of travelers', type: 'number', value: intent.travelers || 1, attrs: 'min="1" max="20"' })}
        ${field({ id: 'destination', label: 'Destination', value: intent.destination || '' })}
        ${field({ id: 'startDate', label: 'Start date', type: 'date', value: intent.startDate || '' })}
        ${field({ id: 'endDate', label: 'End date', type: 'date', value: intent.endDate || '' })}
        ${field({ id: 'notes', label: 'Special requests (optional)', placeholder: 'Window seat, late check-in…', span2: true })}
      </div>

      <hr class="divider">
      <h3>Your picks</h3>
      <div class="small muted" data-picks-empty>No platforms chosen yet — <a href="${esc(links.compare)}">go back to compare</a>. The amount below falls back to the best total from the search.</div>
      <ul class="list" data-picks-list></ul>
    </section>

    <section class="card" data-payment>
      <div class="row between" style="margin-bottom:6px">
        <h2>Payment</h2>
        <span class="badge warn">Dummy widget</span>
      </div>
      <div class="small muted">Razorpay-style, but not Razorpay: no SDK, no network, no real gateway.</div>
      <div class="price" style="margin:12px 0 2px">
        <span data-amount>${esc(formatPrice(fallbackTotal.total, currency) || '—')}</span>
      </div>
      <div class="small muted" data-amount-note>Best total from search snapshot</div>

      <div class="tabs" style="margin-top:14px" role="tablist">
        <button type="button" class="tab active" data-tab="card" role="tab">Card</button>
        <button type="button" class="tab" data-tab="upi" role="tab">UPI</button>
      </div>

      <div data-pane="card">
        <div class="form-grid">
          ${field({ id: 'cardNumber', label: 'Card number (test card only)', placeholder: '4111 1111 1111 1111', span2: true, attrs: 'inputmode="numeric" maxlength="19"' })}
          ${field({ id: 'expiry', label: 'Expiry (MM/YY)', placeholder: '12/30', attrs: 'maxlength="5"' })}
          ${field({ id: 'cvv', label: 'CVV', placeholder: '123', attrs: 'inputmode="numeric" maxlength="4"' })}
          ${field({ id: 'cardName', label: 'Name on card', placeholder: 'TEST TRAVELER', span2: true })}
        </div>
      </div>
      <div data-pane="upi" hidden>
        <div class="form-grid">
          ${field({ id: 'upi', label: 'UPI ID', placeholder: 'test@demo', span2: true })}
        </div>
      </div>

      <div style="margin-top:16px">
        ${button('Pay (dummy)', { block: true, attrs: 'data-pay' })}
        <div class="status" data-pay-status></div>
      </div>
      <div class="small muted" style="margin-top:10px">Clicking Pay shows a fake confirmation. No money moves, nothing is submitted.</div>
    </section>
  </div>

  <section class="confirm" style="margin-top:16px" data-confirmation hidden>
    <div class="row between">
      <h2>Payment confirmed (dummy)</h2>
      <span class="badge ok">Fake confirmation</span>
    </div>
    <dl class="kv" data-confirmation-body></dl>
    <div class="row" style="margin-top:14px">
      <a class="btn" href="${esc(links.summary)}">View trip summary</a>
      ${button('Start over', { secondary: true, attrs: 'data-reset' })}
    </div>
  </section>`;

  const script = `
(function () {
  var MODE = ${JSON.stringify(mode)};
  var CURRENCY = ${JSON.stringify(currency)};
  var FALLBACK_TOTAL = ${JSON.stringify(fallbackTotal.total)};
  var SERVER_PICKS = ${JSON.stringify(picks || {})};
  var TEST_VALUES = ${JSON.stringify(TEST_VALUES)};
  var LABELS = ${JSON.stringify(CATEGORY_LABEL)};

  function $(sel) { return document.querySelector(sel); }
  function fmt(n) { return (CURRENCY === 'USD' ? '$' : '\\u20B9') + Number(n).toLocaleString('en-IN'); }
  function val(id) { return (document.getElementById(id) || {}).value || ''; }
  function setVal(id, v) { var el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input')); } }

  // ---- picks (from the comparison page) --------------------------------
  var picks = SERVER_PICKS;
  if (!Object.keys(picks).length) {
    try { picks = JSON.parse(sessionStorage.getItem('travel-picks') || '{}'); } catch (e) { picks = {}; }
  }
  var amount = 0, priced = 0;
  var list = $('[data-picks-list]');
  Object.keys(picks).forEach(function (cat) {
    var p = picks[cat];
    var li = document.createElement('li');
    li.textContent = (LABELS[cat] || cat) + ': ' + p.platform + (p.price != null ? ' \\u2014 ' + fmt(p.price) : ' \\u2014 no price captured');
    list.appendChild(li);
    if (p.price != null) { amount += Number(p.price); priced++; }
  });
  $('[data-picks-empty]').hidden = Object.keys(picks).length > 0;
  if (priced) {
    $('[data-amount]').textContent = fmt(amount);
    $('[data-amount-note]').textContent = 'Total of your ' + priced + ' priced pick' + (priced === 1 ? '' : 's');
  } else {
    amount = FALLBACK_TOTAL;
  }

  // ---- payment tabs ----------------------------------------------------
  var method = 'card';
  function showTab(name) {
    method = name;
    document.querySelectorAll('[data-tab]').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    document.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
  }
  document.querySelectorAll('[data-tab]').forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
  });

  // Light input formatting so typed and voice-filled values look the same.
  document.getElementById('cardNumber').addEventListener('input', function (e) {
    var d = e.target.value.replace(/\\D/g, '').slice(0, 16);
    e.target.value = d.replace(/(.{4})/g, '$1 ').trim();
  });
  document.getElementById('expiry').addEventListener('input', function (e) {
    var d = e.target.value.replace(/\\D/g, '').slice(0, 4);
    e.target.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  });
  document.getElementById('cvv').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/\\D/g, '').slice(0, 4); });
  document.getElementById('phone').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/\\D/g, '').slice(0, 12); });

  $('[data-fill-test]').addEventListener('click', function () {
    Object.keys(TEST_VALUES).forEach(function (k) { setVal(k, TEST_VALUES[k]); });
  });

  // ---- validation + fake pay -------------------------------------------
  function validate() {
    var errors = [];
    if (!val('name').trim()) errors.push('traveler name');
    if (!/^\\d{10,12}$/.test(val('phone'))) errors.push('a 10-digit phone');
    if (!(Number(val('travelers')) >= 1)) errors.push('number of travelers');
    if (method === 'card') {
      if (val('cardNumber').replace(/\\s/g, '').length !== 16) errors.push('a 16-digit test card number');
      if (!/^(0[1-9]|1[0-2])\\/\\d{2}$/.test(val('expiry'))) errors.push('expiry as MM/YY');
      if (!/^\\d{3,4}$/.test(val('cvv'))) errors.push('a 3-digit CVV');
      if (!val('cardName').trim()) errors.push('name on card');
    } else if (!/^[\\w.\\-]+@[\\w\\-]+$/.test(val('upi').trim())) {
      errors.push('a UPI id like test@demo');
    }
    return errors;
  }

  function fakeId(prefix) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', out = prefix + '_DEMO';
    for (var i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  $('[data-pay]').addEventListener('click', async function () {
    var btn = this, status = $('[data-pay-status]');
    var errors = validate();
    if (errors.length) { status.className = 'status bad'; status.textContent = 'Please provide ' + errors.join(', ') + '.'; return; }
    btn.disabled = true; status.className = 'status'; status.textContent = 'Processing (pretend)\\u2026';
    await new Promise(function (r) { setTimeout(r, 900); });

    // Only a non-sensitive summary is kept: no card number, CVV, expiry or UPI id.
    var confirmation = {
      paymentId: fakeId('pay'),
      orderId: fakeId('order'),
      amount: amount, currency: CURRENCY,
      method: method === 'card' ? 'Card (test card ending ' + val('cardNumber').replace(/\\s/g, '').slice(-4) + ')' : 'UPI',
      traveler: val('name').trim(), travelers: Number(val('travelers')),
      destination: val('destination'), startDate: val('startDate'), endDate: val('endDate'),
      picks: picks, confirmedAt: new Date().toISOString(), dummy: true,
    };
    try { sessionStorage.setItem('travel-confirmation', JSON.stringify(confirmation)); } catch (e) {}
    if (MODE === 'server') {
      try { await fetch('/api/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(confirmation) }); } catch (e) {}
    }
    showConfirmation(confirmation);
    btn.disabled = false; status.textContent = '';
  });

  function showConfirmation(c) {
    var dl = $('[data-confirmation-body]');
    var rows = [
      ['Payment id', c.paymentId], ['Order id', c.orderId], ['Amount', fmt(c.amount)], ['Method', c.method],
      ['Traveler', c.traveler + ' (' + c.travelers + ' traveler' + (c.travelers === 1 ? '' : 's') + ')'],
      ['Trip', c.destination + (c.startDate ? ', ' + c.startDate + (c.endDate ? ' \\u2013 ' + c.endDate : '') : '')],
      ['Status', 'DUMMY \\u2014 no real payment was made'],
    ];
    dl.innerHTML = '';
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    $('[data-checkout]').hidden = true;
    $('[data-confirmation]').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('[data-reset]').addEventListener('click', function () {
    $('[data-confirmation]').hidden = true;
    $('[data-checkout]').hidden = false;
    ['cardNumber', 'expiry', 'cvv', 'upi'].forEach(function (id) { setVal(id, ''); });
  });

  // ---- voice agent (Web Speech API, entirely client-side) ---------------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var synth = window.speechSynthesis;
  var voice = { running: false, rec: null };

  var WORD_NUMBERS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, to: 2, too: 2, for: 4, oh: 0, double: null };
  function digitsFrom(text) {
    // "nine eight seven six" / "98 76" / "double nine" -> digit string
    var out = '';
    text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\\s+/).forEach(function (w, i, arr) {
      if (/^\\d+$/.test(w)) out += w;
      else if (w === 'double' || w === 'triple') { /* handled by lookahead below */ }
      else if (WORD_NUMBERS[w] != null) {
        var prev = arr[i - 1];
        var times = prev === 'double' ? 2 : prev === 'triple' ? 3 : 1;
        for (var k = 0; k < times; k++) out += String(WORD_NUMBERS[w]);
      }
    });
    return out;
  }
  function titleCase(s) { return s.trim().replace(/\\b\\w/g, function (c) { return c.toUpperCase(); }); }

  // Each step: which field to fill, what to ask, how to turn the transcript into a value.
  var STEPS = [
    { id: 'name', ask: 'What is the traveler\\'s full name?', parse: function (t) { return titleCase(t.replace(/^(my name is|it\\'s|it is|this is)\\s+/i, '')); } },
    { id: 'phone', ask: 'What phone number should we use? Say the digits.', parse: function (t) { var d = digitsFrom(t); return d.length >= 10 ? d.slice(0, 12) : null; }, retry: 'I need at least ten digits. Please say the phone number again.' },
    { id: 'travelers', ask: 'How many travelers?', parse: function (t) { var d = digitsFrom(t); var n = parseInt(d, 10); return n >= 1 ? String(n) : null; }, retry: 'Please say a number of travelers, like two.' },
    { id: '__method', ask: 'Would you like to pay by card or by UPI? Both are dummy.', parse: function (t) { if (/upi|u p i|you pee eye/i.test(t)) return 'upi'; if (/card|credit|debit/i.test(t)) return 'card'; return null; }, retry: 'Please say card or UPI.',
      apply: function (v) { showTab(v); } },
    { id: 'cardNumber', when: 'card', ask: 'Say the sixteen digits of a test card number, for example four one one one, repeated.', parse: function (t) { var d = digitsFrom(t); return d.length === 16 ? d : null; }, retry: 'I need exactly sixteen digits. Please repeat the test card number.' },
    { id: 'expiry', when: 'card', ask: 'Expiry month and year? For example, twelve thirty.', parse: function (t) { var d = digitsFrom(t); if (d.length === 3) d = '0' + d; if (d.length === 6) d = d.slice(0, 2) + d.slice(4); return /^(0[1-9]|1[0-2])\\d{2}$/.test(d) ? d : null; }, retry: 'Please say the month and the two-digit year, like twelve thirty.' },
    { id: 'cvv', when: 'card', ask: 'And the three-digit CVV of the test card?', parse: function (t) { var d = digitsFrom(t); return /^\\d{3,4}$/.test(d) ? d : null; }, retry: 'Please say three digits.' },
    { id: 'cardName', when: 'card', ask: 'Name on the card? Say "same" to reuse the traveler name.', parse: function (t) { return /^(same|the same|same name)/i.test(t.trim()) ? val('name').toUpperCase() : t.trim().toUpperCase(); } },
    { id: 'upi', when: 'upi', ask: 'What is the UPI id? For example, test at demo.', parse: function (t) { var s = t.toLowerCase().replace(/\\s+at\\s+/g, '@').replace(/\\s+dot\\s+/g, '.').replace(/\\s+/g, ''); return /^[\\w.\\-]+@[\\w\\-]+$/.test(s) ? s : null; }, retry: 'Please say the UPI id as name, at, provider.' },
  ];

  var statusEl = $('[data-voice-status]');
  var logEl = $('[data-voice-log]');
  function log(text, who) { var d = document.createElement('div'); d.className = who || ''; d.textContent = (who === 'you' ? 'You: ' : 'Agent: ') + text; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }
  function highlight(id) {
    document.querySelectorAll('.field.active').forEach(function (f) { f.classList.remove('active'); });
    var f = document.querySelector('[data-field="' + id + '"]');
    if (f) { f.classList.add('active'); f.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  function speak(text) {
    return new Promise(function (resolve) {
      log(text, 'agent');
      if (!synth) return resolve();
      synth.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-IN'; u.rate = 1.02;
      u.onend = resolve; u.onerror = resolve;
      synth.speak(u);
    });
  }

  function listen() {
    return new Promise(function (resolve) {
      var rec = new SR();
      voice.rec = rec;
      rec.lang = 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 3; rec.continuous = false;
      var done = false;
      function finish(v) { if (!done) { done = true; voice.rec = null; resolve(v); } }
      rec.onresult = function (e) { finish(Array.prototype.map.call(e.results[0], function (a) { return a.transcript; })); };
      rec.onerror = function (e) { if (e.error !== 'aborted') log('(mic error: ' + e.error + ')', 'agent'); finish(null); };
      rec.onend = function () { finish(null); };
      statusEl.textContent = 'Listening\\u2026';
      try { rec.start(); } catch (e) { finish(null); }
    });
  }

  async function runVoice() {
    if (!SR || !synth) {
      statusEl.textContent = 'This browser does not support the Web Speech API — use Chrome, or fill the form by hand.';
      return;
    }
    voice.running = true;
    $('[data-voice-panel]').hidden = false;
    logEl.innerHTML = '';
    await speak('Hi. I will ask a few questions and fill the form for you. You can correct anything by hand afterwards.');
    for (var i = 0; i < STEPS.length && voice.running; i++) {
      var step = STEPS[i];
      if (step.when && step.when !== method) continue;
      if (step.id !== '__method') highlight(step.id);
      var value = null, attempts = 0;
      await speak(step.ask);
      while (value == null && attempts < 3 && voice.running) {
        attempts++;
        var alternatives = await listen();
        if (!voice.running) break;
        if (!alternatives) { if (attempts < 3) await speak('I did not catch that. ' + (step.retry || step.ask)); continue; }
        log(alternatives[0], 'you');
        for (var a = 0; a < alternatives.length && value == null; a++) value = step.parse(alternatives[a]);
        if (value == null && attempts < 3) await speak(step.retry || 'Sorry, please say that again.');
      }
      if (value == null) { await speak('Skipping that one — you can type it in.'); continue; }
      if (step.apply) step.apply(value); else setVal(step.id, value);
      statusEl.textContent = 'Filled ' + (step.id === '__method' ? 'payment method' : step.id) + '.';
    }
    document.querySelectorAll('.field.active').forEach(function (f) { f.classList.remove('active'); });
    if (voice.running) {
      await speak('All done. Please check the fields, then press Pay. Remember, this is a dummy payment.');
      statusEl.textContent = 'Voice fill complete — review the fields, then Pay.';
    }
    voice.running = false;
  }

  $('[data-voice-start]').addEventListener('click', function () { if (!voice.running) runVoice(); });
  $('[data-voice-stop]').addEventListener('click', function () {
    voice.running = false;
    if (voice.rec) { try { voice.rec.abort(); } catch (e) {} }
    if (synth) synth.cancel();
    statusEl.textContent = 'Voice agent stopped.';
    document.querySelectorAll('.field.active').forEach(function (f) { f.classList.remove('active'); });
  });
})();
`;

  return renderPage({
    title: `Details & Payment — ${intent.destination || 'Trip'}`,
    body,
    script,
    activeNav: 'checkout',
    links,
    footer: 'Dummy checkout. No SDK, no gateway, no network call for payment — inputs are discarded when this tab closes.',
  });
}
