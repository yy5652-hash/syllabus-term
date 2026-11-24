import type { GradingComponent } from '../core/schema';

export const DEFAULT_THRESHOLDS: Record<string, number> = {
  A: 93, 'A-': 90, 'B+': 87, B: 83, 'B-': 80, 'C+': 77, C: 73,
};

export type GradeCalculation =
  | { status: 'invalid'; message: string }
  | { status: 'needed' | 'already-secured' | 'not-reachable'; required: number; earned: number; remainingWeight: number };

/** Blank scores are unfinished; required is the weighted average on all unfinished work. */
export function calculateGrade(components: GradingComponent[], scores: (number | null)[], target: number): GradeCalculation {
  if (!components.length || scores.length !== components.length ||
    components.some((c) => !Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 100) ||
    Math.abs(components.reduce((sum, c) => sum + c.weight, 0) - 100) > 0.000001) {
    return { status: 'invalid', message: 'Set grading weights to a total of 100% to calculate your grade.' };
  }
  if (!Number.isFinite(target) || target < 0 || target > 100 ||
    scores.some((s) => s !== null && (!Number.isFinite(s) || s < 0 || s > 100))) {
    return { status: 'invalid', message: 'Enter scores and thresholds between 0 and 100.' };
  }
  let earned = 0;
  let remainingWeight = 0;
  components.forEach((c, i) => {
    if (scores[i] === null) remainingWeight += c.weight;
    else earned += c.weight * scores[i]! / 100;
  });
  const required = remainingWeight ? (target - earned) * 100 / remainingWeight : 0;
  const status = earned + 1e-9 >= target ? 'already-secured'
    : !remainingWeight || required > 100 + 1e-9 ? 'not-reachable' : 'needed';
  return { status, required: Math.max(0, required), earned, remainingWeight };
}
