// Deterministic checks run on every model answer. A "fail" issue means the
// answer for that section is not trusted and the section is escalated to the
// cloud model; a "warn" issue is shown to the student but does not escalate.

import type { GradingResult, ScheduleResult } from './schema';

export type Severity = 'fail' | 'warn';
export interface Issue {
  code: string;
  severity: Severity;
  message: string;
}

export interface CheckReport {
  ok: boolean; // no "fail" issues
  issues: Issue[];
}

const report = (issues: Issue[]): CheckReport => ({ ok: !issues.some((i) => i.severity === 'fail'), issues });

export function parseJson<T>(text: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');

const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'final', 'class', 'course', 'grade', 'total', 'each']);
function significantWords(name: string): string[] {
  return norm(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/** Weight like 30 or 12.5 appears in the text as a percentage (30%, 30 %, 30 percent). */
export function weightGrounded(weight: number, source: string): boolean {
  const s = norm(source);
  const forms = new Set([String(weight), weight.toFixed(1), weight.toFixed(0)].filter((f) => Number(f) === weight));
  for (const f of forms) {
    const esc = f.replace('.', '\\.');
    if (new RegExp(`(^|[^0-9.])${esc}\\s*(%|percent|pct)`).test(s)) return true;
  }
  return false;
}

export function checkGrading(r: GradingResult | null, source: string): CheckReport {
  if (!r || !Array.isArray(r.components)) {
    return report([{ code: 'json', severity: 'fail', message: 'Answer was not valid JSON for the grading schema.' }]);
  }
  const issues: Issue[] = [];
  const comps = r.components;
  if (comps.length === 0) issues.push({ code: 'empty', severity: 'fail', message: 'No grading components found.' });

  const seen = new Set<string>();
  for (const c of comps) {
    const key = norm(c.name).trim();
    if (seen.has(key)) issues.push({ code: 'duplicate', severity: 'fail', message: `"${c.name}" is listed twice.` });
    seen.add(key);
    if (!(typeof c.weight === 'number' && c.weight > 0 && c.weight <= 100)) {
      issues.push({ code: 'range', severity: 'fail', message: `"${c.name}" has weight ${c.weight}, outside 0–100.` });
      continue;
    }
    if (!weightGrounded(c.weight, source)) {
      issues.push({ code: 'weight-not-in-text', severity: 'fail', message: `${c.weight}% for "${c.name}" does not appear in the syllabus.` });
    }
    const words = significantWords(c.name);
    if (words.length > 0 && !words.some((w) => norm(source).includes(w))) {
      issues.push({ code: 'name-not-in-text', severity: 'fail', message: `"${c.name}" is not mentioned in the syllabus.` });
    }
  }

  const sum = comps.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  if (comps.length > 0 && Math.abs(sum - 100) > 0.5) {
    issues.push({ code: 'sum', severity: 'fail', message: `Weights add up to ${round(sum)}%, not 100%.` });
  }
  return report(issues);
}

const round = (x: number) => Math.round(x * 10) / 10;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The date is written somewhere in the text: "Oct 14", "October 14th", "14 Oct", "10/14", "2026-10-14". */
export function dateGrounded(iso: string, source: string): boolean {
  if (!isRealDate(iso)) return false;
  const [, mm, dd] = iso.split('-').map(Number);
  const s = norm(source);
  if (s.includes(iso)) return true;
  const month = MONTHS[mm - 1];
  const names = [month, month.slice(0, 3), month.slice(0, 4)]; // "sept"
  const day = `0?${dd}(st|nd|rd|th)?`;
  for (const n of names) {
    if (new RegExp(`\\b${n}\\.?\\s+${day}\\b`).test(s)) return true;
    if (new RegExp(`\\b${day}\\s+(of\\s+)?${n}\\b`).test(s)) return true;
  }
  if (new RegExp(`(^|[^0-9])0?${mm}/0?${dd}([^0-9]|$)`).test(s)) return true;
  return false;
}

export interface Term {
  start: string; // YYYY-MM-DD
  end: string;
}

export function checkSchedule(r: ScheduleResult | null, source: string, term?: Term): CheckReport {
  if (!r || !Array.isArray(r.items)) {
    return report([{ code: 'json', severity: 'fail', message: 'Answer was not valid JSON for the schedule schema.' }]);
  }
  const issues: Issue[] = [];
  for (const it of r.items) {
    if (!it.label?.trim()) issues.push({ code: 'label', severity: 'fail', message: `An item on ${it.date} has no name.` });
    if (!isRealDate(it.date)) {
      issues.push({ code: 'date-format', severity: 'fail', message: `"${it.label}" has an invalid date "${it.date}".` });
      continue;
    }
    if (!dateGrounded(it.date, source)) {
      issues.push({ code: 'date-not-in-text', severity: 'fail', message: `${it.date} for "${it.label}" does not appear in the syllabus.` });
    }
    if (term && (it.date < term.start || it.date > term.end)) {
      issues.push({ code: 'outside-term', severity: 'fail', message: `"${it.label}" on ${it.date} falls outside the term.` });
    }
  }
  return report(issues);
}
