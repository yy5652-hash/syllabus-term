// Verify-then-escalate: every section is first answered by the hybrid model
// (on device when available). The answer is checked; only a section that fails
// its checks is sent to the cloud model, with the failed checks as hints.

import { checkGrading, checkSchedule, parseJson, type CheckReport, type Term } from './checks';
import { GRADING_SCHEMA, SCHEDULE_SCHEMA, type GradingResult, type ScheduleResult } from './schema';

export type Source = 'on_device' | 'in_cloud';

export interface ModelAnswer {
  text: string;
  source: Source;
}

/** A model call. `schema` is a JSON Schema the answer must follow. */
export type Runner = (prompt: string, schema: object) => Promise<ModelAnswer>;

export interface SectionOutcome<T> {
  section: 'grading' | 'schedule';
  value: T | null;
  firstSource: Source;
  finalSource: Source;
  escalated: boolean;
  firstReport: CheckReport;
  finalReport: CheckReport;
  charsSentToCloud: number;
  ms: number;
  /** Set when escalation was needed but the cloud call failed. */
  escalationError?: string;
  /** Items removed on device because they failed item-level checks. */
  repairedItems: number;
}

export interface RouterOptions {
  /** Hybrid model (PREFER_ON_DEVICE). */
  hybrid: Runner;
  /** Cloud-only model used for escalation. */
  cloud: Runner;
  /** Remote Config can switch escalation off (e.g. quota protection). */
  escalate?: boolean;
  term?: Term;
}

const DATE_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const WEIGHT_RE = /\d\s*(%|percent)/i;

/**
 * Keep only the lines a section needs, plus the nearest non-blank line on each
 * side as context. Blank lines are skipped, so a table exported one cell per
 * line ("| Quiz 1", "", "| 20%") keeps the name next to its weight.
 */
export function sliceSection(text: string, kind: 'grading' | 'schedule'): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const re = kind === 'grading' ? WEIGHT_RE : DATE_RE;
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (re.test(l)) for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < lines.length) keep.add(j);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n').trim();
}

export function gradingPrompt(section: string, hints: string[] = []): string {
  return [
    'Extract the grading breakdown from this course syllabus excerpt.',
    'Return every graded component with its weight as a percent of the final grade (numbers only, e.g. 30 for 30%).',
    'Use only components and numbers written in the text. Do not invent components.',
    ...(hints.length ? ['A previous answer failed these checks; fix them:', ...hints.map((h) => `- ${h}`)] : []),
    '',
    'Syllabus excerpt:',
    section,
  ].join('\n');
}

export function schedulePrompt(section: string, year: number, hints: string[] = []): string {
  return [
    'List every graded event with a date in this course syllabus excerpt: exams, quizzes, and due dates of assignments, problem sets, papers and projects.',
    'Do not list lectures, class topics, readings, holidays, breaks, office hours or add/drop deadlines.',
    `Write dates as YYYY-MM-DD. If the year is not written, the year is ${year}.`,
    'Use only dates written in the text.',
    ...(hints.length ? ['A previous answer failed these checks; fix them:', ...hints.map((h) => `- ${h}`)] : []),
    '',
    'Syllabus excerpt:',
    section,
  ].join('\n');
}

async function runSection<T>(
  section: 'grading' | 'schedule',
  slice: string,
  makePrompt: (hints: string[]) => string,
  schema: object,
  check: (v: T | null) => CheckReport,
  opts: RouterOptions,
  repair?: (v: T | null) => { value: T | null; removed: number },
): Promise<SectionOutcome<T>> {
  const t0 = performance.now();
  let first: ModelAnswer;
  try {
    first = await opts.hybrid(makePrompt([]), schema);
  } catch (e) {
    // On-device failure (e.g. runaway output truncated): treat as a failed
    // answer so the normal escalation path can still produce a result.
    if (opts.escalate === false) throw e;
    first = { text: '', source: 'on_device' };
  }
  const firstValue = parseJson<T>(first.text);
  const firstReport = check(firstValue);
  let out: SectionOutcome<T> = {
    section,
    value: firstValue,
    firstSource: first.source,
    finalSource: first.source,
    escalated: false,
    firstReport,
    finalReport: firstReport,
    charsSentToCloud: first.source === 'in_cloud' ? slice.length : 0,
    ms: 0,
    repairedItems: 0,
  };
  // Repair before escalating: an item whose date is not in the text cannot be
  // fixed by a bigger model reading the same text, so it is removed on device.
  if (!firstReport.ok && repair) {
    const r = repair(firstValue);
    if (r.removed > 0) {
      const rep = check(r.value);
      if (rep.ok) out = { ...out, value: r.value, finalReport: rep, repairedItems: r.removed };
    }
  }
  if (!out.finalReport.ok && first.source === 'on_device' && opts.escalate !== false) {
    const hints = firstReport.issues.filter((i) => i.severity === 'fail').map((i) => i.message);
    try {
      const second = await opts.cloud(makePrompt(hints), schema);
      const v = parseJson<T>(second.text);
      out = { ...out, value: v, finalSource: second.source, escalated: true, finalReport: check(v), charsSentToCloud: slice.length };
    } catch (e) {
      // Cloud unavailable (offline, quota): keep the on-device answer, flagged by its failed checks.
      out = { ...out, escalated: true, escalationError: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}

export interface TermPlan {
  grading: SectionOutcome<GradingResult>;
  schedule: SectionOutcome<ScheduleResult>;
  sourceChars: number;
}

export async function extractTermPlan(text: string, year: number, opts: RouterOptions): Promise<TermPlan> {
  const g = sliceSection(text, 'grading');
  const s = sliceSection(text, 'schedule');
  const grading = await runSection<GradingResult>(
    'grading', g, (h) => gradingPrompt(g, h), GRADING_SCHEMA, (v) => checkGrading(v, g), opts,
  );
  const schedule = await runSection<ScheduleResult>(
    'schedule', s, (h) => schedulePrompt(s, year, h), SCHEDULE_SCHEMA, (v) => checkSchedule(v, s, opts.term), opts,
    (v) => {
      if (!v?.items) return { value: v, removed: 0 };
      const items = v.items.filter((it) => checkSchedule({ items: [it] }, s, opts.term).ok);
      return { value: { ...v, items }, removed: v.items.length - items.length };
    },
  );
  return { grading, schedule, sourceChars: text.length };
}
