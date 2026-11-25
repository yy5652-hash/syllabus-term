import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkGrading, checkSchedule, dateGrounded, evidenceFor } from './checks';
import { findDates, inferTerm, inferYear, lineHasDate } from './dates';
import { extractTermPlan, sliceSection, type Runner } from './router';
import type { DatedItem, GradingComponent } from './schema';

const comp = (name: string, weight: number): GradingComponent => ({ name, weight, kind: 'other' });
const event = (label: string, date: string, kind: DatedItem['kind'] = 'exam'): DatedItem => ({ label, date, kind });
const spring = inferTerm('Spring Semester 2026')!;
const winter = inferTerm('2025 Winter')!;
const failCodes = (r: ReturnType<typeof checkGrading>) => r.issues.filter(i => i.severity === 'fail').map(i => i.code);

it('returns the bound source lines without mutating grading or confusing adjacent dates', () => {
  const survey = Object.freeze(comp('Survey', 3));
  const grading = 'Final 100%\nSurvey\n\n3% extra credit';
  expect(evidenceFor(survey, grading)).toBe('Survey\n3% extra credit');
  expect(evidenceFor(comp('Final', 3), grading)).toBeNull();
  const schedule = 'Midterm December 17\nExam 1\nJan 4';
  expect(evidenceFor(event('Exam 1', '2026-01-04'), schedule, winter)).toBe('Exam 1\nJan 4');
  expect(evidenceFor(event('Exam 2', '2026-01-04'), schedule, winter)).toBeNull();
  expect(evidenceFor(event('Exam 1', '2025-01-04'), schedule, winter)).toBeNull();
});

describe('syllabus dates', () => {
  it('returns exact source offsets, original text and written-year provenance', () => {
    for (const raw of ['September 17', 'Sept. 17th', 'Sep 17', '17 September', '17th of September',
      'Wed, Sep 17', 'Wednesday September 17th', '9/17']) {
      expect(findDates('On ' + raw + '.', 2026)).toEqual([{ raw, index: 3, iso: '2026-09-17', explicitYear: false }]);
    }
    for (const raw of ['September 17th, 2025', '17th of September 2025', '9/17/25', '9/17/2025',
      '9-17-2025', '09-17-25', '2025-09-17']) {
      expect(findDates(raw, 2026, spring)).toEqual([{ raw, index: 0, iso: '2025-09-17', explicitYear: true }]);
    }
  });
  it('finds isolated ordinal and numeric US dates in both slicing and grounding', () => {
    for (const [line, iso] of [['Exam 1 September 17th', '2025-09-17'], ['Midterm on 8-21-2025', '2025-08-21']]) {
      expect(sliceSection('Syllabus\nLectures\n' + line, 'schedule')).toContain(line);
      expect(dateGrounded(iso, line)).toBe(true);
    }
    for (const invalid of ['17/9/2025', '31-10-2025', '2025-02-29', '4/31', 'chapters 2-4']) {
      expect(lineHasDate(invalid)).toBe(false);
    }
  });
  it('infers the first season, or the most frequent year on dated lines', () => {
    expect(inferTerm('Autumn Quarter 2025, then 2026 Spring')).toEqual({ label: 'Fall 2025', start: '2025-08-15', end: '2025-12-31' });
    expect(inferTerm('sometime in 2025')).toBeNull();
    expect(inferYear('2024 2024 2024\nOct 5 2025\n9/17/2025\n10/14/2026')).toBe(2025);
    expect(inferYear('Copyright 2026\nFall')).toBeNull();
    expect(winter.end).toBe('2026-02-28');
    expect(findDates('Dec 18 and Jan 4 and Jan 5, 2025', 2025, winter).map(d => d.iso))
      .toEqual(['2025-12-18', '2026-01-04', '2025-01-05']);
  });
});

describe('bound grading evidence', () => {
  it('rejects the saved Northwestern Midterm II misassignment next to the 45% final', () => {
    const original = readFileSync(new URL('../../../eval/cases/nu-econ201-f2025.txt', import.meta.url), 'utf8');
    const report = checkGrading({ components: [comp('Midterm II', 45)] }, sliceSection(original, 'grading'));
    expect(failCodes(report)).toContain('weight-not-bound');
    expect(failCodes(report)).not.toContain('weight-not-in-text');
  });
  it('rejects both swapped weights on adjacent complete rows', () => {
    const report = checkGrading({ components: [comp('Final', 70), comp('Homework', 30)] }, 'Final 30%\nHomework 70%');
    expect(failCodes(report)).toEqual(['weight-not-bound', 'weight-not-bound']);
  });
  it('supports split cells and equivalent ordinal spellings', () => {
    expect(checkGrading({ components: [comp('Midterm II', 100)] }, 'Second midterm\n\n100 percent').status).toBe('checked');
    expect(failCodes(checkGrading({ components: [comp('Exam 1', 100)] }, 'Second exam 100%'))).toContain('weight-not-bound');
  });
  it('marks additional percentage points and sums only the ordinary components', () => {
    const result = { components: [comp('Homework', 70), comp('Final', 30), comp('Extra credit', 3)] };
    const slice = sliceSection('Homework 70%\nFinal 30%\nExtra credit: up to 3 additional percentage points', 'grading');
    expect(checkGrading(result, slice).status).toBe('checked');
    expect(result.components.map(c => !!c.bonus)).toEqual([false, false, true]);
  });
  it('associates a bonus heading or continuation with its own weight', () => {
    for (const source of ['Final 100%\nExtra credit\nSurvey 3%', 'Final 100%\nSurvey 3%\nadded to your final grade']) {
      const r = { components: [comp('Final', 100), comp('Survey', 3)] };
      expect(checkGrading(r, source).status).toBe('checked');
      expect(r.components.map(c => !!c.bonus)).toEqual([false, true]);
    }
  });

});

describe('schedule evidence, coverage and repair', () => {
  const schedule = 'Midterm October 2\nFinal December 1';
  it('rejects swapped event dates on adjacent rows, including two exams', () => {
    const swapped = [event('Final', '2025-10-02'), event('Midterm', '2025-12-01')];
    expect(failCodes(checkSchedule({ items: swapped }, schedule))).toEqual(['date-not-bound', 'date-not-bound']);
  });
  it('does not bind a named paper to a project just because both are due dates', () => {
    const rows = 'Paper due October 2\nProject due December 1';
    const swapped = [event('Project due', '2025-10-02', 'deadline'), event('Paper due', '2025-12-01', 'deadline')];
    expect(failCodes(checkSchedule({ items: swapped }, rows))).toEqual(['date-not-bound', 'date-not-bound']);
    expect(checkSchedule({ items: [event('Submission', '2025-10-02', 'deadline')] }, rows).status).toBe('checked');
  });
  it('fails empty answers on dated assessment lines and requests review for exams with no dates', () => {
    expect(failCodes(checkSchedule({ items: [] }, schedule))).toContain('missing-dates');
    expect(checkSchedule({ items: [] }, '', undefined, 'Two midterms and a final').status).toBe('review');
    expect(checkSchedule({ items: [] }, 'October 2: first lecture').status).toBe('checked');
  });
  it('keeps a written 2025 date for review in a 2026 term, while removing a changed year', async () => {
    const valid = event('Quiz', '2025-03-10', 'quiz');
    const wrong = { ...valid, date: '2026-03-10' };
    const hybrid: Runner = async p => ({ source: 'on_device', text: JSON.stringify(p.startsWith('Extract')
      ? { components: [comp('Final', 100)] } : { items: [valid, wrong] }) });
    const plan = await extractTermPlan('Final 100%\nQuiz March 10, 2025', 2025, {
      term: spring, hybrid, cloud: async () => { throw new Error('unexpected cloud call'); },
    });
    expect(plan.schedule.value?.items).toEqual([valid]);
    expect(plan.schedule.removed).toEqual([{ item: wrong, reason: 'year-mismatch' }]);
    expect(plan.schedule).toMatchObject({ escalated: false, repairedItems: 1, finalSource: 'on_device',
      finalReport: { status: 'review', issues: [{ code: 'outside-term', severity: 'review' }] } });
  });
  it('uses the confirmed cross-year term in prompts and checks', async () => {
    const prompts: string[] = [];
    const hybrid: Runner = async p => {
      prompts.push(p);
      return { source: 'on_device', text: JSON.stringify(p.startsWith('Extract') ? { components: [comp('Final', 100)] }
        : { items: [event('Exam', '2026-01-04')] }) };
    };
    const plan = await extractTermPlan('Final 100%\nExam Jan 4', 2030, { hybrid, cloud: hybrid, term: winter });
    expect(prompts[1]).toContain('2025-12-15 to 2026-02-28');
    expect(plan.schedule.finalReport.status).toBe('checked');
  });
  it('records an unknown first source and counts even a failed cloud dispatch', async () => {
    const plan = await extractTermPlan(schedule, 2025, {
      hybrid: async () => { throw Error('hybrid failed'); }, cloud: async () => { throw Error('quota'); },
    });
    expect(plan.schedule).toMatchObject({ firstSource: 'unknown', finalSource: 'unknown', escalated: true,
      charsSentToCloud: schedule.length, escalationError: 'quota' });
  });
  it('attributes a repaired cloud answer to the cloud', async () => {
    const invented = event('Quiz', '2025-11-10', 'quiz');
    const plan = await extractTermPlan(schedule, 2025, {
      hybrid: async () => ({ source: 'on_device', text: '{}' }),
      cloud: async () => ({ source: 'in_cloud', text: JSON.stringify({ items: [event('Midterm', '2025-10-02'), invented] }) }),
    });
    expect(plan.schedule).toMatchObject({ finalSource: 'in_cloud', escalated: true, repairedItems: 1,
      removed: [{ item: invented, reason: 'date-not-in-text' }], finalReport: { status: 'checked' } });
  });
});
