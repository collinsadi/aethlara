const MOJIBAKE_MAP: [string, string][] = [
  ['\u00e2\u0080\u00a2', '-'],
  ['\u00e2\u0080\u0094', '--'],
  ['\u00e2\u0080\u0093', '-'],
  ['\u00e2\u0080\u009c', '"'],
  ['\u00e2\u0080\u009d', '"'],
  ['\u00e2\u0080\u0098', "'"],
  ['\u00e2\u0080\u0099', "'"],
  ['\u00e2\u0080\u00a6', '...'],
  ['\u00c2\u00b7', '-'],
  ['\u00c2\u00a0', ' '],
  ['\u00e2\u0084\u00a2', 'TM'],
  ['\u00c2\u00ae', '(R)'],
  ['\u00c2\u00a9', '(C)'],
]

const UNICODE_MAP: [string, string][] = [
  ['\u2022', '-'],
  ['\u25aa', '-'],
  ['\u25b8', '-'],
  ['\u2014', '--'],
  ['\u2013', '-'],
  ['\u00b7', '-'],
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201c', '"'],
  ['\u201d', '"'],
  ['\u2026', '...'],
  ['\u00a0', ' '],
  ['\ufeff', ''],
]

export function sanitiseResumeText(text: string): string {
  if (!text) return text
  let result = text
  for (const [from, to] of MOJIBAKE_MAP) {
    if (result.includes(from)) result = result.split(from).join(to)
  }
  for (const [from, to] of UNICODE_MAP) {
    if (result.includes(from)) result = result.split(from).join(to)
  }
  return result
}
