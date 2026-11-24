// Scoring of one extracted term plan against hand labels.
import type { GradingResult, ScheduleResult } from '../core/schema';

export interface Label {
  id: string;
  year: number;
  term_start: string;
  term_end: string;
  grading: { name: string; weight: number }[] | null;
  dates: { label: string; date: string; kind: string }[] | null;
}

export interface GradingScore {
  exact: boolean; // same multiset of weights, same count
  weightRecall: number; // share of gold weights found (multiset)
  weightPrecision: number;
}

export interface DateScore {
  exact: boolean;
  precision: number;
  recall: number;
}

function multisetOverlap(a: number[], b: number[]): number {
  const pool = [...b];
  let hit = 0;
  for (const x of a) {
    const i = pool.findIndex((y) => Math.abs(x - y) < 0.01);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  return hit;
}

export function scoreGrading(pred: GradingResult | null, gold: Label['grading']): GradingScore | null {
  if (!gold) return null;
  const g = gold.map((c) => c.weight);
  const p = (pred?.components ?? []).map((c) => Number(c.weight));
  const hit = multisetOverlap(p, g);
  return {
    exact: hit === g.length && p.length === g.length,
    weightRecall: g.length ? hit / g.length : 1,
    weightPrecision: p.length ? hit / p.length : 0,
  };
}

export function scoreDates(pred: ScheduleResult | null, gold: Label['dates']): DateScore | null {
  if (!gold) return null;
  const g = new Set(gold.map((d) => d.date));
  const p = new Set((pred?.items ?? []).map((d) => d.date));
  let hit = 0;
  for (const d of p) if (g.has(d)) hit++;
  return {
    exact: hit === g.size && p.size === g.size,
    precision: p.size ? hit / p.size : 0,
    recall: g.size ? hit / g.size : 1,
  };
}

export interface CaseResult {
  id: string;
  mode: string;
  grading: GradingScore | null;
  dates: DateScore | null;
  gradingSource: string;
  datesSource: string;
  gradingEscalated: boolean;
  datesEscalated: boolean;
  gradingChecksOk: boolean;
  datesChecksOk: boolean;
  charsToCloud: number;
  chars: number;
  ms: number;
  error?: string;
  gradingFirstIssues?: string[];
  datesFirstIssues?: string[];
  gradingValue?: unknown;
  datesValue?: unknown;
}

export function summarize(rows: CaseResult[]) {
  const g = rows.filter((r) => r.grading);
  const d = rows.filter((r) => r.dates);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sections = rows.length * 2;
  const onDevice = rows.reduce((a, r) => a + (r.gradingSource === 'on_device' ? 1 : 0) + (r.datesSource === 'on_device' ? 1 : 0), 0);
  return {
    cases: rows.length,
    errors: rows.filter((r) => r.error).length,
    gradingExact: mean(g.map((r) => (r.grading!.exact ? 1 : 0))),
    gradingRecall: mean(g.map((r) => r.grading!.weightRecall)),
    datesExact: mean(d.map((r) => (r.dates!.exact ? 1 : 0))),
    datesRecall: mean(d.map((r) => r.dates!.recall)),
    datesPrecision: mean(d.map((r) => r.dates!.precision)),
    sectionsOnDevice: sections ? onDevice / sections : 0,
    escalations: rows.reduce((a, r) => a + (r.gradingEscalated ? 1 : 0) + (r.datesEscalated ? 1 : 0), 0),
    cloudCharShare: rows.reduce((a, r) => a + r.charsToCloud, 0) / Math.max(1, rows.reduce((a, r) => a + r.chars, 0)),
    medianMs: [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0,
  };
}
