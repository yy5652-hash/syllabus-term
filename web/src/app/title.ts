// Guess a course title from syllabus text: prefer a line that carries a course code
// (e.g. "ECON-UA 2", "CS 101", "6.006"), otherwise the first substantive line.
const CODE = /\b(?:[A-Z]{2,6}(?:[- ][A-Z]{1,3})?[- ]?\d{1,4}[A-Z]?|\d{1,2}\.\d{2,4}[A-Z]?)\b/;
const NOISE = /^(?:page \d+|syllabus|course syllabus|\d+|https?:\/\/\S+)$/i;

export function guessTitle(text: string, filename = ''): string {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20);
  const usable = lines.filter((l) => !NOISE.test(l) && l.length <= 140);
  const pick = usable.find((l) => CODE.test(l)) ?? usable.find((l) => /[a-z]/i.test(l) && l.length >= 6);
  const fromFile = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const title = (pick ?? fromFile) || 'Untitled course';
  return title.length > 90 ? `${title.slice(0, 87).trimEnd()}…` : title;
}
