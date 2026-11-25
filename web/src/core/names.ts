// Shared vocabulary for syllabus evidence and one-to-one evaluation matches.
export const norm = (s: string) => s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');

const stop = new Set(['the', 'and', 'for', 'with', 'your', 'final', 'class', 'course', 'grade', 'total', 'each']);
export function significantWords(name: string): string[] {
  return norm(name).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !stop.has(w));
}

const aliases: [RegExp, string][] = [
  [/\b(?:mid[ -]?terms?|exams?)\b/g, 'exam'],
  [/\b(?:finals?|cumulative)\b/g, 'final'],
  [/\b(?:homeworks?|hw|problem[ -]sets?|psets?|assignments?)\b/g, 'homework'],
  [/\bquiz(?:zes)?\b/g, 'quiz'],
  [/\b(?:participation|attendance)\b/g, 'participation'],
  [/\b(?:papers?|essays?)\b/g, 'paper'],
  [/\bprojects?\b/g, 'project'],
  [/\blabs?\b/g, 'lab'],
  [/\b(test|post|presentation|report)s?\b/g, '$1'],
];
export const assessmentNoun = 'mid[ -]?term|exam|test|quiz|paper|essay|project|assignment|homework|problem[ -]set|lab|blog post|post|presentation|report';
export const pluralSuffix = '(?:s|(?<=quiz)zes)';
const ordinalWords = 'first second third fourth fifth sixth seventh eighth ninth tenth'.split(' ');
const roman = 'i ii iii iv v vi vii viii ix x'.split(' ');
const suffixes = '1st 2nd 3rd 4th 5th 6th 7th 8th 9th 10th'.split(' ');
const explicit = new RegExp('\\b(' + [...ordinalWords, ...suffixes].join('|') + ')\\b', 'gi');
const numbered = new RegExp('\\b((?:' + assessmentNoun + ')' + pluralSuffix + '?)\\s*(10|[1-9]|' + roman.join('|') + ')\\b', 'gi');

export function ordinals(text: string): number[] {
  const label = norm(text);
  const values = [...label.matchAll(explicit)].map(m => Math.max(ordinalWords.indexOf(m[1]), suffixes.indexOf(m[1])) + 1);
  for (const m of label.replace(/\([^()]*\)/g, ' ').matchAll(numbered)) values.push(Number(m[2]) || roman.indexOf(m[2]) + 1);
  return values;
}

export function nameWords(name: string): string[] {
  let normalized = norm(name).replace(numbered, '$1 ').replace(explicit, ' ');
  for (const [pattern, canonical] of aliases) normalized = normalized.replace(pattern, canonical);
  return normalized.split(/[^a-z0-9]+/).filter(w =>
    (w.length >= 4 || w === 'lab' || w === 'due') && (w === 'final' || !stop.has(w)) &&
    /[a-z]/.test(w));
}

export function sharesWord(name: string, evidence: string): boolean {
  const words = new Set(nameWords(evidence));
  return nameWords(name).some(w => words.has(w));
}

export const hasOrdinal = (text: string) => ordinals(text).length > 0;

export function ordinalsMatch(name: string, evidence: string): boolean {
  const found = ordinals(evidence);
  return ordinals(name).every(n => found.includes(n));
}

export function gradingNamesMatch(name: string, other: string): boolean {
  if (norm(name).trim() === norm(other).trim()) return true;
  if (!ordinalsMatch(name, other) || !ordinalsMatch(other, name)) return false;
  // "Final exam" and "Midterm exam" share the generic word "exam".
  if (examConflict(name, other)) return false;
  return sharesWord(name, other);
}

export function examConflict(name: string, other: string): boolean {
  const final = /\b(?:finals?|cumulative)\b/i;
  const midterm = /\bmid[ -]?terms?(?:\b|(?=\d))/i;
  return final.test(name) && midterm.test(other) && !final.test(other) ||
    midterm.test(name) && final.test(other) && !midterm.test(other);
}

// A generic "due" can support an otherwise unnamed deadline. It cannot bind
// a paper to a row which explicitly identifies the assessment as a project.
const specificAssessments = new Set(['homework', 'paper', 'project', 'quiz', 'lab', 'presentation', 'report']);
export function differentAssessments(label: string, evidence: string): boolean {
  const inLabel = nameWords(label).filter(w => specificAssessments.has(w));
  const inRow = nameWords(evidence).filter(w => specificAssessments.has(w));
  return inLabel.length > 0 && inRow.length > 0 && !inLabel.some(w => inRow.includes(w));
}
