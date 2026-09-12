// Small, dependency-free date parsing for the handful of formats a trip
// description or CLI flag is likely to use. Not a general-purpose date
// library — good enough to build search-URL query params.

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** Parses "2026-10-12", "12/10/2026", "12-10-2026", "12 Oct", "12th October 2026", etc. */
export function parseDateFlexible(input, { referenceDate = new Date() } = {}) {
  if (!input) return null;
  const str = String(input).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  m = str.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?(?:\s+(\d{4}))?$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month != null) {
      const year = m[3] ? Number(m[3]) : referenceDate.getFullYear();
      const day = Number(m[1]);
      let date = new Date(year, month, day);
      if (!m[3] && date.getTime() < referenceDate.getTime()) {
        date = new Date(year + 1, month, day);
      }
      return date;
    }
  }

  const native = new Date(str);
  if (!Number.isNaN(native.getTime())) return native;
  return null;
}

/** Skyscanner-style YYMMDD. */
export function formatYYMMDD(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** ixigo-style DDMMYYYY. */
export function formatDDMMYYYY(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${date.getFullYear()}`;
}

export function formatISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
