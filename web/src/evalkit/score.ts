// Scoring of one extracted term plan against hand labels.
import type { CheckReport } from '../core/checks';
import { gradingNamesMatch, hasOrdinal, ordinalsMatch, sharesWord } from '../core/names';
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
  exact: boolean;
  weightsOnlyExact: boolean;
  weightRecall: number; // share of gold weights found (multiset)
  weightPrecision: number;
}

export interface DateScore {
  pairRecall: number;
  pairPrecision: number;
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

// Maximum one-to-one matching. An existing match may move to make room
// for a less flexible prediction (e.g. two exams on the same date).
function matchPairs<P, G>(pred: P[], gold: G[], compatible: (p: P, g: G) => boolean): Set<number> {
  const owners = new Map<number, number>();
  function assign(p: number, tried: Set<number>): boolean {
    for (let g = 0; g < gold.length; g++) {
      if (tried.has(g) || !compatible(pred[p], gold[g])) continue;
      tried.add(g);
      const owner = owners.get(g);
      if (owner === undefined || assign(owner, tried)) {
        owners.set(g, p);
        return true;
      }
    }
    return false;
  }
  pred.forEach((_, i) => assign(i, new Set()));
  return new Set(owners.values());
}

export function scoreGrading(pred: GradingResult | null, gold: Label['grading']): GradingScore | null {
  if (!gold) return null;
  const g = gold.map((c) => c.weight);
  const p = (pred?.components ?? []).map((c) => Number(c.weight));
  // Match required predictions first so an optional bonus never displaces one.
  const components = [...(pred?.components ?? [])].sort((a, b) => Number(!!a.bonus) - Number(!!b.bonus));
  const matched = matchPairs(components, gold, (a, b) => Math.abs(a.weight - b.weight) < 0.01 && gradingNamesMatch(a.name, b.name));
  const hit = multisetOverlap(p, g);
  return {
    exact: matched.size === g.length && components.every((c, i) => c.bonus || matched.has(i)),
    weightsOnlyExact: hit === g.length && p.length === g.length,
    weightRecall: g.length ? hit / g.length : 1,
    weightPrecision: p.length ? hit / p.length : 0,
  };
}

export function scoreDates(pred: ScheduleResult | null, gold: Label['dates']): DateScore | null {
  if (!gold) return null;
  const items = pred?.items ?? [];
  const pairs = matchPairs(items, gold, (a, b) => a.date === b.date &&
    (!hasOrdinal(a.label) || !hasOrdinal(b.label) || (ordinalsMatch(a.label, b.label) && ordinalsMatch(b.label, a.label))) &&
    (sharesWord(a.label, b.label) || (a.kind === 'exam' && b.kind === 'exam'))).size;
  const g = new Set(gold.map((d) => d.date));
  const p = new Set((pred?.items ?? []).map((d) => d.date));
  let hit = 0;
  for (const d of p) if (g.has(d)) hit++;
  return {
    pairRecall: gold.length ? pairs / gold.length : 1,
    pairPrecision: items.length ? pairs / items.length : 0,
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
  gradingEligible?: boolean;
  datesEligible?: boolean;
  datesStatus?: CheckReport['status'];
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
  gradingValue?: GradingResult | null;
  datesValue?: ScheduleResult | null;
}

export function summarize(rows: CaseResult[]) {
  const g = rows.filter(r => r.gradingEligible ?? !!r.grading);
  const d = rows.filter(r => r.datesEligible ?? !!r.dates);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sections = rows.length * 2;
  const onDevice = rows.reduce((a, r) => a + (r.gradingSource === 'on_device' ? 1 : 0) + (r.datesSource === 'on_device' ? 1 : 0), 0);
  return {
    cases: rows.length,
    errors: rows.filter((r) => r.error).length,
    gradingCases: g.length,
    datesCases: d.length,
    gradingExact: mean(g.map(r => Number(!r.error && !!r.grading?.exact))),
    gradingWeightsOnly: mean(g.map(r => Number(!r.error && !!r.grading?.weightsOnlyExact))),
    gradingRecall: mean(g.map(r => r.error ? 0 : r.grading?.weightRecall ?? 0)),
    datesExact: mean(d.map(r => Number(!r.error && !!r.dates?.exact))),
    datesRecall: mean(d.map(r => r.error ? 0 : r.dates?.recall ?? 0)),
    datesPrecision: mean(d.map(r => r.error ? 0 : r.dates?.precision ?? 0)),
    datesPairRecall: mean(d.map(r => r.error ? 0 : r.dates?.pairRecall ?? 0)),
    datesPairPrecision: mean(d.map(r => r.error ? 0 : r.dates?.pairPrecision ?? 0)),
    datesChecked: mean(rows.map(r => Number(!r.error && r.datesStatus === 'checked'))),
    sectionsOnDevice: sections ? onDevice / sections : 0,
    escalations: rows.reduce((a, r) => a + (r.gradingEscalated ? 1 : 0) + (r.datesEscalated ? 1 : 0), 0),
    cloudCharShare: rows.reduce((a, r) => a + r.charsToCloud, 0) / Math.max(1, rows.reduce((a, r) => a + r.chars, 0)),
    medianMs: [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0,
  };
}
