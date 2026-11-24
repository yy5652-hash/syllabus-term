import { describe, expect, it } from 'vitest';
import { checkGrading, checkSchedule, dateGrounded, weightGrounded } from './checks';
import { extractTermPlan, sliceSection, type Runner } from './router';

const SYL = `ECON-UA 2 Principles of Macroeconomics — Fall 2026
Office hours: Tuesdays 2-4pm

Grading
Problem sets 25%
Midterm exam 30%
Final exam 30 percent
Participation 15%

Schedule
Sept 3: first class
Problem set 1 due Sept. 17
Midterm exam: Thursday, October 15th
10/29 Problem set 2 due
Final exam December 17
`;

describe('grounding', () => {
  it('finds weights written as % or percent', () => {
    expect(weightGrounded(25, SYL)).toBe(true);
    expect(weightGrounded(30, SYL)).toBe(true);
    expect(weightGrounded(20, SYL)).toBe(false);
    expect(weightGrounded(5, SYL)).toBe(false); // "25%" must not match 5
  });
  it('finds dates in several formats', () => {
    expect(dateGrounded('2026-09-17', SYL)).toBe(true);
    expect(dateGrounded('2026-10-15', SYL)).toBe(true);
    expect(dateGrounded('2026-10-29', SYL)).toBe(true);
    expect(dateGrounded('2026-12-17', SYL)).toBe(true);
    expect(dateGrounded('2026-12-07', SYL)).toBe(false);
    expect(dateGrounded('2026-02-30', SYL)).toBe(false);
  });
});

describe('checkGrading', () => {
  const good = {
    components: [
      { name: 'Problem sets', weight: 25, kind: 'assignment' as const },
      { name: 'Midterm exam', weight: 30, kind: 'exam' as const },
      { name: 'Final exam', weight: 30, kind: 'exam' as const },
      { name: 'Participation', weight: 15, kind: 'participation' as const },
    ],
  };
  it('accepts a correct answer', () => {
    expect(checkGrading(good, SYL).ok).toBe(true);
  });
  it('rejects a wrong sum, an invented component and a number not in the text', () => {
    const bad = { components: [...good.components.slice(0, 3), { name: 'Quizzes', weight: 20, kind: 'quiz' as const }] };
    const codes = checkGrading(bad, SYL).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['sum', 'name-not-in-text', 'weight-not-in-text']));
  });
  it('rejects non-JSON', () => {
    expect(checkGrading(null, SYL).ok).toBe(false);
  });
});

describe('checkSchedule', () => {
  it('flags a date outside the term and a made-up date', () => {
    const r = {
      items: [
        { label: 'Midterm exam', date: '2026-10-15', kind: 'exam' as const },
        { label: 'Final exam', date: '2027-12-17', kind: 'exam' as const },
        { label: 'Quiz', date: '2026-11-05', kind: 'quiz' as const },
      ],
    };
    const rep = checkSchedule(r, SYL, { start: '2026-09-01', end: '2026-12-23' });
    expect(rep.ok).toBe(false);
    expect(rep.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['outside-term', 'date-not-in-text']));
  });
});

describe('router', () => {
  it('keeps only relevant lines per section', () => {
    expect(sliceSection(SYL, 'grading')).toContain('Midterm exam 30%');
    expect(sliceSection(SYL, 'grading')).not.toContain('December 17');
    expect(sliceSection(SYL, 'schedule')).toContain('October 15th');
  });

  it('keeps the name of a one-cell-per-line table row next to its weight', () => {
    const table = '| Assignments\n\n| Percentages\n\n| Quiz 1\n\n| 20%\n\n| Final Exam\n\n| 35%\n';
    const g = sliceSection(table, 'grading');
    expect(g).toContain('Quiz 1');
    expect(g).toContain('Final Exam');
  });

  it('escalates only the section that fails its checks', async () => {
    const calls: string[] = [];
    const hybrid: Runner = async (prompt) => {
      calls.push('device');
      if (prompt.startsWith('Extract the grading')) {
        return { source: 'on_device', text: JSON.stringify({ components: [{ name: 'Midterm exam', weight: 30, kind: 'exam' }] }) };
      }
      return { source: 'on_device', text: JSON.stringify({ items: [{ label: 'Final exam', date: '2026-12-17', kind: 'exam' }] }) };
    };
    const cloud: Runner = async (prompt) => {
      calls.push('cloud');
      expect(prompt).toContain('not 100%'); // failed checks are passed as hints
      return {
        source: 'in_cloud',
        text: JSON.stringify({
          components: [
            { name: 'Problem sets', weight: 25, kind: 'assignment' },
            { name: 'Midterm exam', weight: 30, kind: 'exam' },
            { name: 'Final exam', weight: 30, kind: 'exam' },
            { name: 'Participation', weight: 15, kind: 'participation' },
          ],
        }),
      };
    };
    const plan = await extractTermPlan(SYL, 2026, { hybrid, cloud });
    expect(calls).toEqual(['device', 'cloud', 'device']);
    expect(plan.grading.escalated).toBe(true);
    expect(plan.grading.finalReport.ok).toBe(true);
    expect(plan.schedule.escalated).toBe(false);
    expect(plan.schedule.charsSentToCloud).toBe(0);
    expect(plan.grading.charsSentToCloud).toBeLessThan(SYL.length);
  });

  it('removes invented dates on device instead of escalating', async () => {
    const calls: string[] = [];
    const hybrid: Runner = async (prompt) => {
      calls.push('device');
      if (prompt.startsWith('Extract the grading')) {
        return { source: 'on_device', text: JSON.stringify({ components: [
          { name: 'Problem sets', weight: 25, kind: 'assignment' }, { name: 'Midterm exam', weight: 30, kind: 'exam' },
          { name: 'Final exam', weight: 30, kind: 'exam' }, { name: 'Participation', weight: 15, kind: 'participation' }] }) };
      }
      return { source: 'on_device', text: JSON.stringify({ items: [
        { label: 'Final exam', date: '2026-12-17', kind: 'exam' },
        { label: 'quizzes', date: '2026-11-05', kind: 'quiz' }] }) };
    };
    const cloud: Runner = async () => { calls.push('cloud'); throw new Error('should not be called'); };
    const plan = await extractTermPlan(SYL, 2026, { hybrid, cloud });
    expect(calls).toEqual(['device', 'device']);
    expect(plan.schedule.escalated).toBe(false);
    expect(plan.schedule.repairedItems).toBe(1);
    expect(plan.schedule.finalReport.ok).toBe(true);
    expect(plan.schedule.value?.items.map((i) => i.date)).toEqual(['2026-12-17']);
  });

  it('falls back to the cloud when the on-device call throws', async () => {
    const hybrid: Runner = async () => { throw new Error('The response exceeded output limits and was truncated.'); };
    const cloud: Runner = async (_p, schema) => ({ source: 'in_cloud', text: 'components' in (schema as { properties: object }).properties
      ? JSON.stringify({ components: [
        { name: 'Problem sets', weight: 25, kind: 'assignment' }, { name: 'Midterm exam', weight: 30, kind: 'exam' },
        { name: 'Final exam', weight: 30, kind: 'exam' }, { name: 'Participation', weight: 15, kind: 'participation' }] })
      : JSON.stringify({ items: [{ label: 'Final exam', date: '2026-12-17', kind: 'exam' }] }) });
    const plan = await extractTermPlan(SYL, 2026, { hybrid, cloud });
    expect(plan.grading.finalSource).toBe('in_cloud');
    expect(plan.grading.finalReport.ok).toBe(true);
    expect(plan.schedule.finalReport.ok).toBe(true);
  });

  it('keeps the on-device answer when the cloud call fails', async () => {
    const hybrid: Runner = async () => ({ source: 'on_device', text: '{"components":[{"name":"Midterm exam","weight":30,"kind":"exam"}]}' });
    const cloud: Runner = async () => {
      throw new Error('429 quota');
    };
    const plan = await extractTermPlan(SYL, 2026, { hybrid, cloud });
    expect(plan.grading.escalated).toBe(true);
    expect(plan.grading.finalSource).toBe('on_device');
    expect(plan.grading.finalReport.ok).toBe(false);
    expect(plan.grading.escalationError).toContain('429');
  });
});
