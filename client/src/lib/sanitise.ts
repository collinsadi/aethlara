// Two-pass text sanitiser for AI-generated content displayed in the UI.
//
// Pass 1: Mojibake repair — fixes UTF-8 bytes misread as Windows-1252.
// Pass 2: Unicode normalisation — replaces typographic characters with ASCII.
//
// This is a client-side safety net. The primary fix is server-side; this
// catches any corruption that predates the backend fix or slips through.

const MOJIBAKE_MAP: [string, string][] = [
  // U+2022 BULLET
  ['\u00e2\u0080\u00a2', '-'],
  // U+2014 EM DASH
  ['\u00e2\u0080\u0094', '--'],
  // U+2013 EN DASH
  ['\u00e2\u0080\u0093', '-'],
  // U+201C LEFT DOUBLE QUOTATION MARK
  ['\u00e2\u0080\u009c', '"'],
  // U+201D RIGHT DOUBLE QUOTATION MARK
  ['\u00e2\u0080\u009d', '"'],
  // U+2018 LEFT SINGLE QUOTATION MARK
  ['\u00e2\u0080\u0098', "'"],
  // U+2019 RIGHT SINGLE QUOTATION MARK
  ['\u00e2\u0080\u0099', "'"],
  // U+2026 HORIZONTAL ELLIPSIS
  ['\u00e2\u0080\u00a6', '...'],
  // U+00B7 MIDDLE DOT
  ['\u00c2\u00b7', '-'],
  // U+00A0 NO-BREAK SPACE
  ['\u00c2\u00a0', ' '],
  // U+2122 TRADE MARK SIGN
  ['\u00e2\u0084\u00a2', 'TM'],
  // U+00AE REGISTERED SIGN
  ['\u00c2\u00ae', '(R)'],
  // U+00A9 COPYRIGHT SIGN
  ['\u00c2\u00a9', '(C)'],
]

const UNICODE_MAP: [string, string][] = [
  ['\u2022', '-'],    // BULLET
  ['\u25aa', '-'],    // BLACK SMALL SQUARE
  ['\u25b8', '-'],    // BLACK RIGHT-POINTING SMALL TRIANGLE
  ['\u2014', '--'],   // EM DASH
  ['\u2013', '-'],    // EN DASH
  ['\u00b7', '-'],    // MIDDLE DOT
  ['\u2018', "'"],    // LEFT SINGLE QUOTATION MARK
  ['\u2019', "'"],    // RIGHT SINGLE QUOTATION MARK
  ['\u201c', '"'],    // LEFT DOUBLE QUOTATION MARK
  ['\u201d', '"'],    // RIGHT DOUBLE QUOTATION MARK
  ['\u2026', '...'],  // HORIZONTAL ELLIPSIS
  ['\u00a0', ' '],    // NO-BREAK SPACE
  ['\ufeff', ''],     // BOM
  ['\u00ae', '(R)'],  // REGISTERED SIGN
  ['\u00a9', '(C)'],  // COPYRIGHT SIGN
  ['\u2122', 'TM'],   // TRADE MARK SIGN
]

export function sanitiseResumeText(text: string): string {
  if (!text) return text

  let result = text

  for (const [from, to] of MOJIBAKE_MAP) {
    if (result.includes(from)) {
      result = result.split(from).join(to)
    }
  }

  for (const [from, to] of UNICODE_MAP) {
    if (result.includes(from)) {
      result = result.split(from).join(to)
    }
  }

  return result
}

export function sanitiseResumeArray(items: string[]): string[] {
  return items.map(sanitiseResumeText)
}
