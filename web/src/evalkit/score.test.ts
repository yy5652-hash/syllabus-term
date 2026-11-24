import { describe, expect, it } from 'vitest';
import { scoreDates, scoreGrading, summarize, type CaseResult } from './score';

describe('scoring', () => {
  it('grading: multiset of weights', () => {
    const gold = [{ name: 'A', weight: 30 }, { name: 'B', weight: 30 }, { name: 'C', weight: 40 }];
    expect(scoreGrading({ components: [{ name: 'x', weight: 30, kind: 'exam' }, { name: 'y', weight: 30, kind: 'exam' }, { name: 'z', weight: 40, kind: 'exam' }] }, gold)!.exact).toBe(true);
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
  it('summary counts on-device sections', () => {
    const r: CaseResult = { id: 'x', mode: 'hybrid', grading: { exact: true, weightRecall: 1, weightPrecision: 1 }, dates: null, gradingSource: 'on_device', datesSource: 'in_cloud', gradingEscalated: false, datesEscalated: true, gradingChecksOk: true, datesChecksOk: true, charsToCloud: 50, chars: 200, ms: 10 };
    const s = summarize([r]);
    expect(s.sectionsOnDevice).toBe(0.5);
    expect(s.cloudCharShare).toBe(0.25);
    expect(s.gradingExact).toBe(1);
  });
});
