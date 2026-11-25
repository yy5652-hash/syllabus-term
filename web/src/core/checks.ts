import { binds, gradingEvidence, groupParts } from './grading';
export { lineHasWeight, weightGrounded } from './grading';
import { findDates, isRealDate, type DateMatch, type Term } from './dates';
import { differentAssessments, examConflict, hasOrdinal, norm, ordinalsMatch, sharesWord, significantWords } from './names';
import type { DateKind, DatedItem, GradingComponent, GradingResult, ScheduleResult } from './schema';

export { isRealDate, type Term } from './dates';
export const SUM_TOLERANCE = 0.5;
export type Severity = 'fail' | 'warn' | 'review';
export interface Issue {
  code: string;
  severity: Severity;
  message: string;
}

export interface CheckReport {
  ok: boolean; // no fail issues; use status for the checked badge
  status: 'checked' | 'review' | 'failed';
  issues: Issue[];
}

function report(issues: Issue[]): CheckReport {
  const ok = !issues.some(i => i.severity === 'fail');
  return { ok, status: !ok ? 'failed' : issues.some(i => i.severity === 'review') ? 'review' : 'checked', issues };
}

export function parseJson<T>(text: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

const linesOf = (s: string) => s.split(/\r?\n/).filter(l => l.trim());

// A neighbouring row with its own value is independent evidence. Only borrow
// unanchored neighbours (e.g. the name cell above a standalone percentage).
function context(lines: string[], i: number, anchors: boolean[], separator = ' ') {
  return [i - 1, i, i + 1].filter(j => j >= 0 && j < lines.length && (j === i || !anchors[j]))
    .map(j => lines[j]).join(separator);
}

export function checkGrading(r: GradingResult | null, source: string): CheckReport {
  if (!r || !Array.isArray(r.components) || r.components.some(c => !c || typeof c.name !== 'string')) {
    return report([{ code: 'json', severity: 'fail', message: 'Answer was not valid JSON for the grading schema.' }]);
  }
  const issues: Issue[] = [];
  const comps = r.components;
  if (comps.length === 0) issues.push({ code: 'empty', severity: 'fail', message: 'No grading components found.' });
  const { rows, pointMode } = gradingEvidence(source);
  if (pointMode) {
    for (const c of comps) {
      if (c.points !== undefined && rows.some(row => row.bonus && binds(c, c.points!, row))) c.bonus = true;
    }
    const pointsSum = comps.reduce((sum, c) => sum + (c.bonus ? 0 : c.points ?? 0), 0);
    const total = r.totalPoints ?? pointsSum;
    r.totalPoints = total;
    const writtenTotal = rows.some(row => row.entries.some(e => e.value === total && /\btotal\b/i.test(e.label)));
    if (!Number.isFinite(total) || total <= 0 || (!writtenTotal && Math.abs(total - pointsSum) > 1e-7)) {
      issues.push({ code: 'total-points', severity: 'fail', message: 'Check the total points against the course total.' });
    }
    for (const c of comps) {
      c.weight = typeof c.points === 'number' && Number.isFinite(c.points) && total > 0
        ? Math.round(c.points / total * 10000) / 100 : 0;
    }
  }
  const seen = new Set<string>();
  for (const c of comps) {
    const key = norm(c.name).trim();
    if (seen.has(key)) issues.push({ code: 'duplicate', severity: 'fail', message: `"${c.name}" is listed twice.` });
    seen.add(key);
    if (!(typeof c.weight === 'number' && c.weight > 0 && c.weight <= 100)) {
      issues.push({ code: 'range', severity: 'fail', message: `"${c.name}" has weight ${c.weight}, outside 0–100.` });
      continue;
    }
    const amount = pointMode ? c.points! : c.weight;
    const unit = pointMode ? ' points' : '%';
    const bound = rows.filter(row => binds(c, amount, row));
    const group = groupParts(c, rows, pointMode) !== undefined;
    if (group) issues.push({ code: 'group-has-parts', severity: 'fail', message: `Split '${c.name}' into its parts` });
    if (!rows.some(row => row.entries.some(e => e.value === amount)) && !group) {
      issues.push({ code: 'weight-not-in-text', severity: 'fail', message: `${amount}${unit} for "${c.name}" does not appear in the syllabus.` });
    }
    const words = significantWords(c.name);
    if (!bound.length && words.length > 0 && !sharesWord(c.name, source) && !words.some(w => norm(source).includes(w))) {
      issues.push({ code: 'name-not-in-text', severity: 'fail', message: `"${c.name}" is not mentioned in the syllabus.` });
    }
    if (bound.some(row => row.bonus)) c.bonus = true;
    if (!bound.length && !group) issues.push({ code: 'weight-not-bound', severity: 'fail', message: `Cannot link "${c.name}" to ${amount}${unit} in its grading row.` });
  }

  const sum = comps.reduce((a, c) => a + (c.bonus ? 0 : Number(c.weight) || 0), 0);
  if (comps.length > 0 && Math.abs(sum - 100) > SUM_TOLERANCE) {
    issues.push({ code: 'sum', severity: 'fail', message: `Weights add up to ${Math.round(sum * 10) / 10}%, not 100%.` });
  }
  return report(issues);
}

export function dateGrounded(iso: string, source: string, term?: Term): boolean {
  return isRealDate(iso) && findDates(source, Number(term?.start.slice(0, 4) ?? iso.slice(0, 4)), term).some(d => d.iso === iso);
}

const examWord = /\b(?:exams?|mid[ -]?terms?|finals?|quiz(?:zes)?)\b/i;
const kindWords: Partial<Record<DateKind, RegExp>> = {
  exam: /\b(?:exams?|mid[ -]?terms?|finals?|tests?)\b/i,
  quiz: /\bquiz(?:zes)?\b/i,
  deadline: /\b(?:due|deadlines?|assignments?|homework|papers?|projects?|presentations?|reports?)\b/i,
};

function dateBound(it: DatedItem, text: string, row: DateMatch[]): boolean {
  // Remove date digits before looking for event ordinals such as Exam 1.
  const evidence = row.reduce((s, d) => s.replace(d.raw, ' '), text);
  return (!hasOrdinal(evidence) || ordinalsMatch(it.label, evidence)) && !examConflict(it.label, evidence) &&
    !differentAssessments(it.label, evidence) && (sharesWord(it.label, evidence) || !!kindWords[it.kind]?.test(evidence));
}

export function checkSchedule(r: ScheduleResult | null, source: string, term?: Term, fullText = source, defaultYear?: number): CheckReport {
  if (!r || !Array.isArray(r.items) || r.items.some(it => !it || typeof it.date !== 'string' || typeof it.label !== 'string')) {
    return report([{ code: 'json', severity: 'fail', message: 'Answer was not valid JSON for the schedule schema.' }]);
  }
  const issues: Issue[] = [];
  const lines = linesOf(source);
  const year = term ? Number(term.start.slice(0, 4)) : defaultYear;
  const datedLines = (y: number) => lines.map(l => findDates(l, y, term));
  const dates = datedLines(year ?? 2000);
  if (!r.items.length && lines.some((l, i) => dates[i].length && (examWord.test(l) || /\b(?:tests?|due|deadlines?)\b/i.test(l)))) {
    issues.push({ code: 'missing-dates', severity: 'fail', message: 'The schedule lists dated assessments, but the answer contains none.' });
  }
  if (!lines.length && examWord.test(fullText)) {
    issues.push({ code: 'no-dates', severity: 'review', message: 'We found exams in this syllabus but no dates for them. Check the course schedule.' });
  }
  for (const it of r.items) {
    if (!it.label.trim()) issues.push({ code: 'label', severity: 'fail', message: `An item on ${it.date} has no name.` });
    if (!isRealDate(it.date)) {
      issues.push({ code: 'date-format', severity: 'fail', message: `"${it.label}" has an invalid date "${it.date}".` });
      continue;
    }
    const rows = year === undefined ? datedLines(Number(it.date.slice(0, 4))) : dates;
    const anchors = rows.map(row => row.length > 0);
    let grounded = false;
    let bound = false;
    for (const [i, row] of rows.entries()) {
      if (!row.some(d => d.iso === it.date)) continue;
      grounded = true;
      const text = context(lines, i, anchors);
      if (dateBound(it, text, row)) bound = true;
    }
    if (!grounded) {
      issues.push({ code: 'date-not-in-text', severity: 'fail', message: `${it.date} for "${it.label}" does not appear in the syllabus.` });
      const sameDay = rows.flat().filter(d => d.iso.slice(5) === it.date.slice(5));
      if (sameDay.length && sameDay.every(d => d.explicitYear)) {
        issues.push({ code: 'year-mismatch', severity: 'fail', message: `The written year for "${it.label}" differs from ${it.date.slice(0, 4)}.` });
      }
    } else if (!bound) {
      issues.push({ code: 'date-not-bound', severity: 'fail', message: `Cannot link "${it.label}" to ${it.date} in the schedule.` });
    }
    if (term && (it.date < term.start || it.date > term.end)) {
      const boundary = it.date < term.start ? 'starts ' + term.start : 'ends ' + term.end;
      issues.push({ code: 'outside-term', severity: 'review', message: `${term.label ? term.label + ' term' : 'Term'} ${boundary}; check the term or this date (${it.date}).` });
    }
  }
  return report(issues);
}

/** Return the first bound window, preserving the original line breaks. */
export function evidenceFor(item: GradingComponent | DatedItem, sectionText: string, term?: Term): string | null {
  const lines = linesOf(sectionText);
  if ('weight' in item) {
    if (!(item.weight > 0 && item.weight <= 100)) return null;
    const { rows, pointMode } = gradingEvidence(sectionText);
    const value = pointMode ? item.points : item.weight;
    return value === undefined ? null : rows.find(row => binds(item, value, row))?.window ?? null;
  }

  if (!isRealDate(item.date) || !item.label.trim()) return null;
  const year = Number(term?.start.slice(0, 4) ?? item.date.slice(0, 4));
  const dates = lines.map(line => findDates(line, year, term));
  const anchors = dates.map(row => row.length > 0);
  const i = dates.findIndex((row, j) => row.some(d => d.iso === item.date) && dateBound(item, context(lines, j, anchors), row));
  return i < 0 ? null : context(lines, i, anchors, '\n');
}

export interface RemovedItem {
  item: DatedItem;
  reason: string;
}
