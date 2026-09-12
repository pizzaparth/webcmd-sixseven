// Shared page template for every generated page (comparison page,
// details+payment page, summary page). One place for the dark theme and the
// small component set, so each page consumes it instead of carrying its own
// CSS — see ../../plan.md → "Design Template".
//
// Rules baked in here (plan.md → "Design Template"):
//   - Dark theme only: --bg / --surface / --surface-2 with light --text.
//   - No gradients anywhere. Flat solid colors only.
//   - No translucent "pill" badges: .badge is a solid bg + 4px radius.
//   - Every text/background pair is checked for contrast — all pairs below
//     pass WCAG AA (≥ 4.5:1; lowest is badge ok at 5.05:1). Badge text is
//     always white or --accent-text on a solid tone, never the tone's hue.
//   - One accent (--accent, amber) for buttons and links; dark text on it.
//
// Pages call renderPage() with a body string and use the classes here
// (.card, .badge.<tone>, .btn[.secondary][.block], .banner, .grid, .row,
// .field, .tabs, .kv, .notice, .status, .table-wrap). Adding a new page
// means writing markup against these classes, not new CSS.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON for embedding in an inline <script>. JSON.stringify leaves `<`
 * untouched, so a value containing `</script>` would close the element early
 * and turn page data into markup — platform names and titles here come from
 * scraped pages, so that is reachable. Also escapes the two line separators
 * that are valid JSON but not valid JavaScript string literals.
 */
export function jsonScript(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}

const CSS = `
:root {
  --bg: #0f1115;
  --surface: #171a21;
  --surface-2: #1f232c;
  --border: #2c313d;
  --text: #e8eaf0;
  --muted: #9aa3b2;
  --accent: #ffb224;
  --accent-hover: #ffc457;
  --accent-text: #111318;
  --ok-bg: #2e7d4f;    --ok-text: #ffffff;
  --warn-bg: #b7791f;  --warn-text: #111318;
  --bad-bg: #a63d3d;   --bad-text: #ffffff;
  --info-bg: #2f5fa8;  --info-text: #ffffff;
  --neutral-bg: #3a4050; --neutral-text: #ffffff;
  --radius: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.5;
  padding: 0 20px 48px;
}
a { color: var(--accent); }
a:hover { color: var(--accent-hover); }
.wrap { max-width: 1040px; margin: 0 auto; }
.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 18px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px;
}
.brand { font-weight: 700; font-size: 17px; letter-spacing: 0.2px; }
.brand span { color: var(--accent); }
.nav { display: flex; gap: 14px; flex-wrap: wrap; }
.nav a { color: var(--muted); text-decoration: none; font-size: 14px; }
.nav a.active, .nav a:hover { color: var(--text); }
h1 { font-size: 26px; margin: 0 0 6px; }
h2 { font-size: 18px; margin: 0; }
h3 { font-size: 16px; margin: 0; }
.sub { color: var(--muted); margin: 0 0 20px; }
.section { margin-top: 28px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.section-head .meta { color: var(--muted); font-size: 13px; }
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;
}
.card.selected { border-color: var(--accent); }
.card.best { border-color: var(--ok-bg); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.mono { font-family: var(--mono); }
.price { font-size: 26px; font-weight: 700; margin: 10px 0 2px; }
.price.none { font-size: 16px; font-weight: 500; color: var(--muted); }
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;
  letter-spacing: 0.3px; text-transform: uppercase; line-height: 18px;
}
.badge.ok { background: var(--ok-bg); color: var(--ok-text); }
.badge.warn { background: var(--warn-bg); color: var(--warn-text); }
.badge.bad { background: var(--bad-bg); color: var(--bad-text); }
.badge.info { background: var(--info-bg); color: var(--info-text); }
.badge.neutral { background: var(--neutral-bg); color: var(--neutral-text); }
.badge.accent { background: var(--accent); color: var(--accent-text); }
.btn {
  display: inline-block; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text);
  font: inherit; font-weight: 600; padding: 9px 16px; border-radius: 6px; cursor: pointer; text-decoration: none;
}
.btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn:disabled { opacity: 0.55; cursor: default; }
.btn.secondary { background: transparent; color: var(--accent); }
.btn.secondary:hover { background: var(--surface-2); }
.btn.block { width: 100%; text-align: center; }
.banner {
  background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent);
  border-radius: var(--radius); padding: 18px 20px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
}
.banner .label { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; }
.banner .big { font-size: 34px; font-weight: 700; line-height: 1.15; }
.banner .right { text-align: right; }
.live { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); }
.live .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ok-bg); display: inline-block; }
.live .dot.blink { animation: blink 1.2s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
.list { margin: 8px 0 0; padding-left: 20px; }
.list li { margin: 4px 0; }
.status { min-height: 20px; font-size: 13px; margin-top: 8px; }
.status.ok { color: #6fd39a; }
.status.bad { color: #f08a8a; }
.notice {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 10px 14px; color: var(--muted); font-size: 13px;
}
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 13px; color: var(--muted); }
input, select, textarea {
  font: inherit; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 6px; padding: 9px 11px; width: 100%;
}
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
.field.active input { outline: 2px solid var(--accent); border-color: var(--accent); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 13px; }
.table-wrap { overflow-x: auto; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 760px) { .two-col { grid-template-columns: 1fr; } }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-grid .span2 { grid-column: span 2; }
@media (max-width: 480px) { .form-grid { grid-template-columns: 1fr; } .form-grid .span2 { grid-column: auto; } }
.tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
.tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--muted); font: inherit; font-weight: 600; padding: 8px 12px; cursor: pointer; }
.tab.active { color: var(--text); border-bottom-color: var(--accent); }
.divider { border: 0; border-top: 1px solid var(--border); margin: 16px 0; }
.log { font-family: var(--mono); font-size: 12px; color: var(--muted); max-height: 160px; overflow-y: auto; margin-top: 10px; }
.log div { padding: 2px 0; }
.log .you { color: var(--text); }
.confirm { border: 1px solid var(--ok-bg); border-radius: var(--radius); padding: 18px; background: var(--surface); }
.confirm h2 { color: #6fd39a; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin-top: 10px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; }
footer { margin-top: 40px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); padding-top: 16px; }
`;

/** Solid-color badge; `tone` picks a validated bg/text pair, never same-hue. */
export function badge(text, tone = 'neutral') {
  return `<span class="badge ${esc(tone)}">${esc(text)}</span>`;
}

export function button(label, { attrs = '', secondary = false, block = false, disabled = false } = {}) {
  const cls = ['btn', secondary ? 'secondary' : '', block ? 'block' : ''].filter(Boolean).join(' ');
  return `<button type="button" class="${cls}" ${disabled ? 'disabled' : ''} ${attrs}>${esc(label)}</button>`;
}

export const DEFAULT_LINKS = { compare: '/', checkout: '/checkout', summary: '/summary' };

const NAV = [
  { key: 'compare', label: 'Compare' },
  { key: 'checkout', label: 'Details & Payment' },
  { key: 'summary', label: 'Summary' },
];

/**
 * Wraps page `body` (already-rendered HTML) in the shared shell.
 * `script` is inline client JS (no external assets — pages work offline and
 * from a static file just as well as from the local server).
 */
export function renderPage({ title, body, script = '', activeNav = 'compare', footer = '', links = DEFAULT_LINKS }) {
  const nav = NAV.map(
    (n) => `<a href="${esc(links[n.key])}" class="${n.key === activeNav ? 'active' : ''}">${esc(n.label)}</a>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand">Travel <span>Concierge</span></div>
    <nav class="nav">${nav}</nav>
  </div>
  ${body}
  <footer>${footer || 'Demo project. Nothing on these pages logs in to, submits to, or pays on any real site.'}</footer>
</div>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}
