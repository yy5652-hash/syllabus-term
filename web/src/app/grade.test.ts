import { describe, expect, it } from 'vitest';
import { calculateGrade } from './grade';
import type { GradingComponent } from '../core/schema';

const components: GradingComponent[] = [
  { name: 'Coursework', weight: 40, kind: 'assignment' },
  { name: 'Final', weight: 60, kind: 'exam' },
];

describe('grade calculator', () => {
  it('calculates the required final score without rounding an unreachable score down', () => {
    expect(calculateGrade(components, [90, null], 93)).toMatchObject({ status: 'needed', required: 95 });
    expect(calculateGrade(components, [80, null], 93).status).toBe('not-reachable');
    expect(calculateGrade(components, [82.499, null], 93).status).toBe('not-reachable');
  });
  it('distinguishes blank from zero and accepts a needed score of exactly 100', () => {
    expect(calculateGrade(components, [0, null], 60)).toMatchObject({ status: 'needed', required: 100 });
    expect(calculateGrade(components, [null, null], 93)).toMatchObject({ required: 93, remainingWeight: 100 });
  });
  it('calculates a weighted average across multiple remaining components', () => {
    const multi = [...components.slice(0, 1), { name: 'Midterm', weight: 20, kind: 'exam' as const }, { ...components[1], weight: 40 }];
    expect(calculateGrade(multi, [90, null, null], 90)).toMatchObject({ status: 'needed', required: 90, remainingWeight: 60 });
  });
  it('handles secured targets and all-finished work', () => {
    expect(calculateGrade(components, [100, null], 40).status).toBe('already-secured');
    expect(calculateGrade(components, [90, 90], 90).status).toBe('already-secured');
    expect(calculateGrade(components, [80, 80], 90).status).toBe('not-reachable');
  });
  it('rejects invalid inputs and inconsistent weights', () => {
    for (const score of [-1, 101, NaN, Infinity]) expect(calculateGrade(components, [score, null], 93).status).toBe('invalid');
    expect(calculateGrade(components, [90], 93).status).toBe('invalid');
    expect(calculateGrade([], [], 93).status).toBe('invalid');
    expect(calculateGrade(components, [90, null], NaN).status).toBe('invalid');
    expect(calculateGrade([{ ...components[0], weight: 99.6 }], [null], 93).status).toBe('invalid');
  });
});
