export interface Term {
  label?: string;
  start: string;
  end: string;
}

export interface DateMatch {
  iso: string;
  explicitYear: boolean;
  index: number;
  raw: string;
}

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const month = '(?:' + [...months, 'sept', ...months.map(m => m.slice(0, 3))].join('|') + ')\\.?';
const weekday = '(?:(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\\.?,?[ \\t]+)?';
const day = (name: string) => `(?<${name}>\\d{1,2})(?:st|nd|rd|th)?`;
const space = '[ \\t]+';
const year = (name: string) => `(?:,?${space}(?<${name}>\\d{4}))?`;
// Slash dates may omit the year. A hyphenated number range such as
// "chapters 2-4" only qualifies when it has a third (year) field.
const pattern = new RegExp('\\b' + weekday + '(?:' + [
  '(?<isoYear>\\d{4})-(?<isoMonth>\\d{2})-' + day('isoDay'),
  '(?<slashMonth>\\d{1,2})/' + day('slashDay') + '(?:/(?<slashYear>\\d{4}|\\d{2}))?(?!/\\d)',
  '(?<dashMonth>\\d{1,2})-' + day('dashDay') + '-(?<dashYear>\\d{4}|\\d{2})',
  '(?<monthFirst>' + month + ')' + space + day('dayAfter') + year('yearAfter'),
  day('dayFirst') + space + '(?:of' + space + ')?(?<monthAfter>' + month + ')(?!' + space + '\\d{1,2}(?:st|nd|rd|th)?\\b)' + year('yearLast'),
].join('|') + ')\\b', 'gi');

const isoDate = (year: number, month: number, day: number) =>
  [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');

export function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso + 'T');
}

export function findDates(text: string, defaultYear: number, term?: Term): DateMatch[] {
  const result: DateMatch[] = [];
  for (const m of text.matchAll(pattern)) {
    const g = m.groups!;
    const named = g.monthFirst ?? g.monthAfter;
    const mm = named ? months.findIndex(x => x.startsWith(named.slice(0, 3).toLowerCase())) + 1
      : Number(g.isoMonth ?? g.slashMonth ?? g.dashMonth);
    const dd = Number(g.isoDay ?? g.slashDay ?? g.dashDay ?? g.dayAfter ?? g.dayFirst);
    const written = g.isoYear ?? g.slashYear ?? g.dashYear ?? g.yearAfter ?? g.yearLast;
    let iso = isoDate(written ? Number(written) + (written.length === 2 ? 2000 : 0) : defaultYear, mm, dd);
    if (!written && term) {
      for (let y = Number(term.start.slice(0, 4)); y <= Number(term.end.slice(0, 4)); y++) {
        const candidate = isoDate(y, mm, dd);
        if (candidate >= term.start && candidate <= term.end && isRealDate(candidate)) {
          iso = candidate;
          break;
        }
      }
    }
    if (isRealDate(iso)) result.push({ iso, explicitYear: !!written, index: m.index, raw: m[0] });
  }
  return result;
}

export const lineHasDate = (line: string) => findDates(line, 2000).length > 0;

export function inferTerm(text: string): (Term & { label: string }) | null {
  const season = '(Fall|Autumn|Spring|Summer|Winter)';
  const y = '(20[0-9]{2})';
  const re = new RegExp('\\b(?:' + season + '(?:\\s+(?:Term|Semester|Quarter))?\\s+' + y + '|' + y + '\\s+' + season + ')\\b', 'i');
  const match = re.exec(text);
  if (!match) return null;
  const name = (match[1] ?? match[4]).toLowerCase();
  const year = Number(match[2] ?? match[3]);
  const spans: Record<string, [string, string, string]> = {
    fall: ['Fall', '08-15', '12-31'], autumn: ['Fall', '08-15', '12-31'],
    spring: ['Spring', '01-01', '05-31'], summer: ['Summer', '05-15', '08-31'],
    winter: ['Winter', '12-15', '02-28'],
  };
  const [label, start, end] = spans[name];
  return { label: label + ' ' + year, start: year + '-' + start, end: (year + Number(name === 'winter')) + '-' + end };
}

export function inferYear(text: string): number | null {
  const counts = new Map<number, number>();
  for (const line of text.split(/\r?\n/)) {
    if (!lineHasDate(line)) continue;
    for (const match of line.matchAll(/\b20\d{2}\b/g)) {
      const y = Number(match[0]);
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
