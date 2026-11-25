import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTermPlan, type Runner } from '../core/router';
import { updateSyllabusInput } from './App';
import { CoursePlan, removeGradingRow, undoGradingRemoval } from './CoursePlan';
import { extractWithProgress } from './pipeline';
import { SAMPLE } from './sample';
import { loadCourses, newCalculator, saveCourses, type Course } from './storage';
import { ProgressRow } from './ui';

const text = 'Spring 2026\nHomework 40%\nFinal 60%\nQuiz March 10, 2025';
const term = { label: 'Spring 2026', start: '2026-01-01', end: '2026-05-31' };
const runner: Runner = async prompt => ({
  source: 'in_cloud',
  text: prompt.startsWith('Extract') ? JSON.stringify({ components: [
    { name: 'Homework', weight: 40, kind: 'assignment' }, { name: 'Final', weight: 60, kind: 'exam' },
  ] }) : JSON.stringify({ items: [
    { label: 'Quiz', date: '2025-03-10', kind: 'quiz' }, { label: 'Quiz', date: '2026-03-10', kind: 'quiz' },
  ] }),
});

async function courseFixture(): Promise<Course> {
  const plan = await extractTermPlan(text, 2026, { hybrid: runner, cloud: runner, term });
  return { id: 'course', title: 'Statistics', sourceText: text, term, plan,
    components: plan.grading.value!.components.map((c, i) => ({ ...c, id: `grade-${i}` })),
    dates: plan.schedule.value!.items.map((item, i) => ({ ...item, id: `date-${i}` })),
    ...newCalculator(),
  };
}

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('grading corrections', () => {
  it('removes the row by ID and can undo for eight seconds with its original position and score', async () => {
    const course = await courseFixture();
    course.scores = { 'grade-0': '89', 'grade-1': '93' };
    const { next, removal } = removeGradingRow(course, 'grade-0', 1000)!;
    expect(next.components.map(c => c.id)).toEqual(['grade-1']);
    expect(next.scores).toEqual({ 'grade-1': '93' });
    const edited = { ...next, scores: { 'grade-1': '94' } };
    expect(undoGradingRemoval(edited, removal, 8999)).toEqual({ ...course, scores: { 'grade-0': '89', 'grade-1': '94' } });
    expect(undoGradingRemoval(edited, removal, 9000)).toBe(edited);
  });

  it('round-trips row IDs, removals, edits, scores, the target and cut-offs on reopen', async () => {
    stubStorage();
    const course = await courseFixture();
    const { next } = removeGradingRow(course, 'grade-0')!;
    next.components[0] = { ...next.components[0], name: 'Final paper', kind: 'project', weight: 100 };
    next.scores = { 'grade-1': '95.5' };
    next.target = 'A-';
    next.thresholds['A-'] = '89';
    expect(next.plan.schedule.finalReport.status).toBe('review');
    expect(saveCourses([next])).toBe('');
    expect(loadCourses()).toEqual({ courses: [next], error: '' });
  });

  it('preserves points through extraction, storage and the grading label', async () => {
    stubStorage();
    const sourceText = 'Homework 300 pts\nStudio 700 points\nTotal 1000 points';
    const model: Runner = async (_prompt, schema) => ({ source: 'on_device', text: JSON.stringify(
      'components' in (schema as { properties: object }).properties ? { components: [
        { name: 'Homework', points: 300, kind: 'assignment' }, { name: 'Studio', points: 700, kind: 'other' },
      ] } : { items: [] }) });
    const sections: string[] = [];
    const plan = await extractWithProgress(sourceText, 2026, { hybrid: model, cloud: model }, undefined,
      progress => { if (progress.state === 'reading') sections.push(progress.section); });
    expect(sections).toEqual(['grading', 'schedule']);
    const base = await courseFixture();
    const course = { ...base, plan, sourceText, components: plan.grading.value!.components.map((c, i) => ({ ...c, id: String(i) })) };
    expect(saveCourses([course])).toBe('');
    const restored = loadCourses().courses[0];
    expect(renderToStaticMarkup(<CoursePlan course={restored} onChange={() => {}} onSave={() => {}} saved />))
      .toContain('Converted from points (300 of 1000)');
  });

  it('migrates old rows and reports that lack calculator fields, statuses and removal details', async () => {
    const storage = stubStorage();
    const course = await courseFixture();
    const { scores, target, thresholds, ...old } = course;
    const { status, ...oldReport } = course.plan.grading.finalReport;
    const { removed, ...oldOutcome } = course.plan.grading;
    storage.set('syllabus-term:courses:v1', JSON.stringify([{
      ...old,
      components: old.components.map(({ id, ...component }) => component),
      plan: { ...old.plan, grading: { ...oldOutcome, firstReport: oldReport, finalReport: oldReport } },
    }]));
    const loaded = loadCourses();
    expect(loaded.courses[0]).toMatchObject({ scores, target, thresholds, plan: { grading: { finalReport: { status }, removed: [] } } });
    const ids = loaded.courses[0].components.map(c => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(saveCourses(loaded.courses)).toBe('');
    expect(loadCourses().courses[0].components.map(c => c.id)).toEqual(ids);
  });
});

it('resets the term for PDF, pasted text and sample, and uses the edited term in the schedule prompt', async () => {
  const now = new Date(2026, 2, 1);
  const pasted = updateSyllabusInput({ text: '', filename: '', term, termOrigin: 'default', showTermDates: true },
    { type: 'load', text: 'Fall 2025\nFinal Oct 15' });
  expect(pasted).toMatchObject({ term: { label: 'Fall 2025', start: '2025-08-15' }, termOrigin: 'inferred', showTermDates: false });
  const edited = updateSyllabusInput(pasted, { type: 'edit-term', field: 'start', value: '2024-12-15' });
  const pdf = updateSyllabusInput(edited, { type: 'load', text: 'Final Oct 15', filename: 'course.pdf', now });
  expect(pdf).toMatchObject({ filename: 'course.pdf', term: { start: '2026-01-12' }, termOrigin: 'default', showTermDates: true });
  const sample = updateSyllabusInput(pdf, { type: 'load', text: SAMPLE });
  expect(sample).toMatchObject({ filename: '', term: { label: 'Fall 2026', start: '2026-08-15' }, showTermDates: false });
  const changed = updateSyllabusInput(sample, { type: 'edit-term', field: 'start', value: '2025-12-15' });
  const prompts: string[] = [];
  const capture: Runner = async (prompt, schema) => { prompts.push(prompt); return runner(prompt, schema); };
  await extractWithProgress(changed.text, 2030, { hybrid: capture, cloud: capture }, changed.term, () => {});
  expect(prompts[1]).toContain('2025-12-15 to 2026-12-31');
});

it('renders a review badge and removals from the cloud report without a checkmark', async () => {
  const { plan } = await courseFixture();
  const html = renderToStaticMarkup(<ProgressRow progress={{ section: 'schedule', state: 'done', outcome: plan.schedule }} sourceChars={plan.sourceChars} />);
  expect(html).toContain('Needs your review');
  expect(html).toContain('Spring 2026 term starts 2026-01-01');
  expect(html).toContain('Read in cloud');
  expect(html).toContain('Not added');
  expect(html).toContain('The year differs from the written date.');
  expect(html).not.toContain('✓');
});
