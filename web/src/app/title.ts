// Guess a course title from syllabus text: prefer a "Course:" line, then a line that carries a
// course code (e.g. "ECON-UA 2", "CS 101", "6.006", "History 104"), otherwise the first substantive line.
const CODE = /\b(?:[A-Z]{2,6}(?:[- ][A-Z]{1,3})?[- ]?\d{1,4}[A-Z]?|\d{1,2}\.\d{2,4}[A-Z]?)\b/g;
const WORD_CODE = /^[A-Z][a-z]+(?: [A-Z][a-z]+)? \d{3,5}\b/;
const SEASON = /^(?:fall|autumn|spring|summer|winter)\b/i;
const NOISE = /^(?:page \d+|syllabus|course syllabus|\d+|https?:\/\/\S+|(?:fall|autumn|spring|summer|winter)[ ,]*(?:term|semester|quarter)?[ ,]*\d{4}(?: syllabus)?)$/i;
// Lines about where, when or who ("Location LSRC B101", "Wednesdays 2-3 pm, JNH 3005") are not titles.
const LOGISTICS = /^(?:location|room|place|building|time|times|hours?|office|office hours|instructor|professor|lecturer|ta|email|e-mail|phone|lectures?|labs?|class(?:es)? meets?|meeting|section|day|days|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|department|college|school|the university|university)\b/i;
const LABEL = /^course(?: number)?(?: (?:and|&) (?:title|name))?(?: title| name)?\s*:\s*/i;

const clean = (l: string) => l.replace(/\s+/g, ' ').trim().replace(/^[•▪◦·*–-]+\s*/, '');
const hasCode = (l: string) => (l.match(CODE) ?? []).some((m) => !SEASON.test(m));

export function guessTitle(text: string, filename = ''): string {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean).slice(0, 30);
  const usable = lines.filter((l) => !NOISE.test(l) && !LOGISTICS.test(l) && l.length <= 140);
  const labelled = usable.find((l) => LABEL.test(l) && l.replace(LABEL, '').length >= 4);
  let pick = labelled?.replace(LABEL, '');
  if (!pick) {
    const coded = usable.find(hasCode) ?? usable.find((l) => WORD_CODE.test(l));
    if (coded) {
      // A bare code line ("ECO 2023") borrows the course name from the line after it.
      const after = lines[lines.indexOf(coded) + 1];
      const next = after && usable.includes(after) ? after : undefined;
      const bare = coded.replace(CODE, '').replace(/[\d\s\-–:,.]/g, '').length <= 12;
      pick = bare && next && /[a-z]/i.test(next) && next.length <= 70 && !hasCode(next) ? `${coded} ${next}` : coded;
    }
  }
  pick ??= usable.find((l) => /[a-z]/i.test(l) && l.length >= 6);
  const fromFile = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const title = (pick ?? fromFile) || 'Untitled course';
  return title.length > 90 ? `${title.slice(0, 87).trimEnd()}…` : title;
}
