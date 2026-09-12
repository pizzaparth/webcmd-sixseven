// CLI-only reporting. This is intentionally the entire "comparison UI" for
// now — Adarsh's website reads output/<trip>.json to build the real
// comparison page later; this just needs to be readable in a terminal.

function currencySymbol(code) {
  return code === 'USD' ? '$' : '₹';
}

function formatPrice(candidate) {
  if (!candidate) return '—';
  return `${currencySymbol(candidate.currency)}${candidate.price.toLocaleString('en-IN')}`;
}

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

export function printComparisonTables(results) {
  const byCategory = new Map();
  for (const r of results) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category).push(r);
  }

  for (const [category, rows] of byCategory) {
    console.log(`\n=== ${category.toUpperCase()} ===`);
    const tableRows = rows.map((r) => ({
      Platform: r.platform,
      Confidence: r.confidence,
      Price: formatPrice(r.pick),
      'Best match': truncate(r.pick?.title, 40),
      Source: r.usedFallbackHomepage ? 'homepage (no deep link)' : 'deep link',
      URL: truncate(r.url, 60),
      Error: r.error || '',
    }));
    console.table(tableRows);

    for (const r of rows) {
      if (r.candidates.length > 1) {
        console.log(`  ${r.platform} — other candidates on the same page:`);
        for (const c of r.candidates.slice(1)) {
          console.log(`    ${formatPrice(c)}  ${truncate(c.title, 70)}`);
        }
      }
    }
  }
}

export function printPlaces(places) {
  if (!places) return;
  console.log(`\n=== PLACES TO EXPLORE ===`);
  console.log(`Query: "${places.query}"`);
  console.log(`URL: ${places.url}`);
  if (places.error) console.log(`Note: ${places.error}`);
  for (const line of places.shortlist) console.log(`  - ${line}`);
}

export function printOpenTabsSummary(openTabs, outputPath) {
  console.log(`\n=== RETAINED SESSIONS/TABS (left open on purpose) ===`);
  if (!openTabs.length) {
    console.log('  (none — dry run, or every category was skipped)');
  }
  for (const t of openTabs) {
    console.log(`  [${t.category}] ${t.platform} — profile "${t.profile}", session "${t.sessionId}"`);
  }
  console.log('  (nothing above was closed — inspect any of them with:');
  console.log('   webcmd --profile <profile> --session <session> browser tabs)');
  if (outputPath) console.log(`\nTrip data written to: ${outputPath}`);
}
