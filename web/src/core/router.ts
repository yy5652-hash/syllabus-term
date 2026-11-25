// Verify-then-escalate: every section is first answered by the hybrid model
// (on device when available). The answer is checked; only a section that fails
// its checks is sent to the cloud model, with the failed checks as hints.

import { checkGrading, checkSchedule, parseJson, type RemovedItem, type CheckReport, type Term } from './checks';
import { gradingRows, splitGroups } from './grading';
import { inferTerm, inferYear, lineHasDate } from './dates';
import { GRADING_SCHEMA, POINTS_SCHEMA, SCHEDULE_SCHEMA, type GradingResult, type ScheduleResult } from './schema';

export type Source = 'on_device' | 'in_cloud' | 'unknown';

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
  /** Number of grading groups split or dated items removed from the retained answer. */
  repairedItems: number;
  removed: RemovedItem[];
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

/**
 * Keep only the lines a section needs, plus the nearest non-blank line on each
 * side as context. Blank lines are skipped, so a table exported one cell per
 * line ("| Quiz 1", "", "| 20%") keeps the name next to its weight.
 */
export function sliceSection(text: string, kind: 'grading' | 'schedule'): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const anchors = kind === 'grading' ? gradingRows(text).anchors : lines.map(lineHasDate);
  const keep = new Set<number>();
  anchors.forEach((anchored, i) => {
    if (anchored) for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < lines.length) keep.add(j);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n').trim();
}

export function gradingPrompt(section: string, hints: string[] = []): string {
  return [
    'Extract the grading breakdown from this course syllabus excerpt.',
    gradingRows(section).pointMode ? 'Return each graded component with its points and the course totalPoints if written. Omit weight.' :
    'Return every graded component with its weight as a percent of the final grade (numbers only, e.g. 30 for 30%).',
    "List each separately weighted item. If a group is split into parts with their own percentages, or says 'N% each', list the parts (e.g. Midterm 30%, Final 40%; Test 1 15%, Test 2 15%, Test 3 15%), not the group.",
    'Mark extra credit added on top of 100% with bonus: true.',
    'Use only components and numbers written in the text. Do not invent components.',
    ...(hints.length ? ['A previous answer failed these checks; fix them:', ...hints.map((h) => `- ${h}`)] : []),
    '',
    'Syllabus excerpt:',
    section,
  ].join('\n');
}

export function schedulePrompt(section: string, year: number, hints: string[] = [], term?: Term): string {
  return [
    'List every graded event with a date in this course syllabus excerpt: exams, quizzes, and due dates of assignments, problem sets, papers and projects.',
    'Do not list lectures, class topics, readings, holidays, breaks, office hours or add/drop deadlines.',
    term && term.start.slice(0, 4) !== term.end.slice(0, 4)
      ? `Write dates as YYYY-MM-DD. For dates without a year, use the year inside the term ${term.start} to ${term.end} where possible. Otherwise use ${year}.`
      : `Write dates as YYYY-MM-DD. If the year is not written, the year is ${year}.`,
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
  repair?: (v: T | null) => { value: T | null; removed?: RemovedItem[]; repairedItems?: number },
): Promise<SectionOutcome<T>> {
  const t0 = performance.now();
  let first: ModelAnswer;
  const cloudFirst = opts.hybrid === opts.cloud;

  try {
    first = await opts.hybrid(makePrompt([]), schema);
  } catch {
    first = { text: '', source: 'unknown' };
  }

  // A thrown hybrid call has no source receipt. A known cloud-only first
  // dispatch (the cloud runner used in both positions) still counts on error.
  const dispatchedToCloud = first.source === 'in_cloud' || (cloudFirst && first.source === 'unknown');

  function evaluate(answer: ModelAnswer) {
    const value = parseJson<T>(answer.text);
    const initial = check(value);
    const repaired = initial.status === 'failed' && repair ? repair(value) : undefined;
    const removed = repaired?.removed ?? [];
    const finalValue = repaired ? repaired.value : value;
    return {
      initial, value: finalValue, removed, repairedItems: repaired?.repairedItems ?? removed.length,
      finalReport: (repaired?.repairedItems ?? removed.length) ? check(finalValue) : initial,
    };
  }

  const { initial: firstReport, ...result } = evaluate(first);
  let out: SectionOutcome<T> = {
    section, ...result, firstSource: first.source, finalSource: first.source,
    escalated: false, firstReport, charsSentToCloud: dispatchedToCloud ? slice.length : 0, ms: 0,
  };
  if (out.finalReport.status === 'failed' && !dispatchedToCloud && opts.escalate !== false) {
    const hints = out.finalReport.issues.filter(i => i.severity === 'fail').map(i => i.message);
    out.escalated = true;
    out.charsSentToCloud += slice.length;
    try {
      const second = await opts.cloud(makePrompt(hints), schema);
      const { initial: _initial, ...cloudResult } = evaluate(second);
      out = { ...out, ...cloudResult, finalSource: 'in_cloud' };
    } catch (e) {
      out.escalationError = String((e as Error)?.message ?? e).slice(0, 200);
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
    'grading', g, (h) => gradingPrompt(g, h), gradingRows(g).pointMode ? POINTS_SCHEMA : GRADING_SCHEMA, (v) => checkGrading(v, g), opts, v => splitGroups(v, g),
  );
  const scheduleYear = opts.term ? Number(opts.term.start.slice(0, 4))
    : Number(inferTerm(text)?.start.slice(0, 4) ?? inferYear(text) ?? year);
  const checkDates = (v: ScheduleResult | null) => checkSchedule(v, s, opts.term, text, scheduleYear);
  const schedule = await runSection<ScheduleResult>(
    'schedule', s, h => schedulePrompt(s, scheduleYear, h, opts.term), SCHEDULE_SCHEMA, checkDates, opts,
    v => {
      const removed: RemovedItem[] = [];
      if (!Array.isArray(v?.items)) return { value: v, removed };
      const items = v.items.filter(item => {
        const issues = checkDates({ items: [item] }).issues;
        const reason = ['date-format', 'year-mismatch', 'date-not-in-text', 'date-not-bound']
          .find(code => issues.some(issue => issue.code === code));
        if (reason) removed.push({ item, reason });
        return !reason;
      });
      return { value: { items }, removed };
    },
  );
  return { grading, schedule, sourceChars: text.length };
}
