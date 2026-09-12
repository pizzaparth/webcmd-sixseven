// The `browser run` program bodies we send to webcmd (see docs/cli-reference.mdx
// → "Browser Programs"). Sandbox globals available: page, context, browser,
// console. No Node, filesystem, env, or context.newPage() access — one page
// per Session is all we get, which is why the orchestrator uses one Session
// per category/platform instead of multiple tabs inside a single Session.

/** Navigates the current page to `url` and reports back what actually loaded. */
export function gotoScript(url) {
  return `
const result = { url: null, title: null, error: null };
try {
  await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch (e) {
    // Fine if the page keeps polling in the background — we only need the
    // initial content to have rendered.
  }
  result.url = page.url();
  result.title = await page.title();
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
}
return result;
`;
}
