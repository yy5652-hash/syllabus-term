import { describe, expect, it } from 'vitest';
import type { GradingComponent } from '../core/schema';
import { scoreDates, scoreGrading, summarize, type CaseResult } from './score';

describe('scoring', () => {
  it('grading: multiset of weights', () => {
    const gold = [{ name: 'A', weight: 30 }, { name: 'B', weight: 30 }, { name: 'C', weight: 40 }];
    expect(scoreGrading({ components: [{ name: 'x', weight: 30, kind: 'exam' }, { name: 'y', weight: 30, kind: 'exam' }, { name: 'z', weight: 40, kind: 'exam' }] }, gold)!.weightsOnlyExact).toBe(true);
    const s = scoreGrading({ components: [{ name: 'x', weight: 30, kind: 'exam' }, { name: 'z', weight: 40, kind: 'exam' }] }, gold)!;
    expect(s.exact).toBe(false);
    expect(s.weightRecall).toBeCloseTo(2 / 3);
    expect(scoreGrading(null, null)).toBeNull();
  });
  it('dates: set precision and recall', () => {
    const gold = [{ label: 'a', date: '2026-10-01', kind: 'exam' }, { label: 'b', date: '2026-11-01', kind: 'exam' }];
    const s = scoreDates({ items: [{ label: 'a', date: '2026-10-01', kind: 'exam' }, { label: 'c', date: '2026-12-01', kind: 'exam' }] }, gold)!;
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(0.5);
    expect(s.exact).toBe(false);
  });
  it('strict grading rejects swapped names and ordinals with identical weights', () => {
    const gold = [{ name: 'First midterm', weight: 30 }, { name: 'Second midterm', weight: 70 }];
    const pred = (a: string, b: string) => ({ components: [
      { name: a, kind: 'exam' as const, weight: 30 }, { name: b, kind: 'exam' as const, weight: 70 },
    ] });
    expect(scoreGrading(pred('Exam 1', 'Mid-term II'), gold)?.exact).toBe(true);
    expect(scoreGrading(pred('Midterm II', 'Exam 1'), gold)).toMatchObject({ exact: false, weightsOnlyExact: true });
    expect(scoreGrading(pred('Homework', 'Final'), [{ name: 'Final', weight: 30 }, { name: 'HW', weight: 70 }])?.exact).toBe(false);
  });
  it('matches each component once, allowing only unmatched bonus predictions', () => {
    const component: GradingComponent = { name: 'Pset', kind: 'assignment', weight: 100 };
    const gold = [{ name: 'Homework', weight: 100 }];
    const bonus = { ...component, bonus: true };
    expect(scoreGrading({ components: [bonus, component] }, gold)).toMatchObject({ exact: true, weightsOnlyExact: false });
    expect(scoreGrading({ components: [component, component] }, gold)?.exact).toBe(false);
  });
  it('scores event pairs independently of date sets and consumes each gold event once', () => {
    const gold = [{ label: 'Essay', date: '2025-09-17', kind: 'deadline' as const },
      { label: 'Quiz', date: '2025-09-19', kind: 'quiz' as const }];
    const swapped = [{ ...gold[0], date: gold[1].date }, { ...gold[1], date: gold[0].date }];
    expect(scoreDates({ items: swapped }, gold)).toMatchObject({ exact: true, pairRecall: 0, pairPrecision: 0 });
    const paper = { ...gold[0], label: 'Paper' };
    expect(scoreDates({ items: [paper, paper] }, gold)).toMatchObject({ pairRecall: 0.5, pairPrecision: 0.5 });
  });
  it('rejects a different numbered event on the same day and accepts its ordinal spelling', () => {
    const item = { label: 'exam2', date: '2026-03-10', kind: 'exam' as const };
    expect(scoreDates({ items: [item] }, [{ ...item, label: 'Third exam' }])?.pairRecall).toBe(0);
    expect(scoreDates({ items: [item] }, [{ ...item, label: 'Exam II' }])?.pairRecall).toBe(1);
  });
  it('counts eligible errors and uses every schedule for checked coverage', () => {
    const scores: CaseResult = {
      id: 'good', mode: 'cloud', grading: { exact: true, weightsOnlyExact: true, weightRecall: 1, weightPrecision: 1 },
      dates: null, gradingSource: 'in_cloud', datesSource: 'in_cloud', gradingEscalated: false, datesEscalated: false,
      gradingChecksOk: true, datesChecksOk: true, datesStatus: 'review', charsToCloud: 30, chars: 60, ms: 1,
    };
    const error = { ...scores, grading: null, gradingEligible: true, datesEligible: false, error: 'quota' };
    const checked = { ...scores, grading: null, datesStatus: 'checked' as const };
    expect(summarize([scores, error, checked])).toMatchObject({
      cases: 3, errors: 1, gradingCases: 2, datesCases: 0, gradingExact: 0.5, gradingWeightsOnly: 0.5, datesChecked: 1 / 3,
    });
  });
  it('summary counts on-device sections', () => {
    const r: CaseResult = { id: 'x', mode: 'hybrid', grading: { exact: true, weightsOnlyExact: true, weightRecall: 1, weightPrecision: 1 }, dates: null, gradingSource: 'on_device', datesSource: 'in_cloud', gradingEscalated: false, datesEscalated: true, gradingChecksOk: true, datesChecksOk: true, charsToCloud: 50, chars: 200, ms: 10 };
    const s = summarize([r]);
    expect(s.sectionsOnDevice).toBe(0.5);
    expect(s.cloudCharShare).toBe(0.25);
    expect(s.gradingExact).toBe(1);
  });
});
