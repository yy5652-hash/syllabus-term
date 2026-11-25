import { describe, expect, it } from 'vitest';
import { checkGrading, evidenceFor } from './checks';
import { extractTermPlan, gradingPrompt, sliceSection } from './router';
import type { GradingComponent, GradingResult } from './schema';
import { ordinals } from './names';
import { scoreGrading } from '../evalkit/score';

const component = (name: string, weight = 100): GradingComponent => ({ name, weight, kind: 'other' });
const issues = (value: GradingResult, text: string) => checkGrading(value, text).issues.map(i => i.code);
async function route(text: string, answer: object) {
  return (await extractTermPlan(text, 2026, {
    hybrid: async p => ({ text: JSON.stringify(p.startsWith('Extract') ? answer : { items: [] }), source: 'on_device' }),
    cloud: async () => { throw new Error('Unexpected escalation'); },
  })).grading;
}

describe('assessment ordinals', () => {
  it.each([
    ['10 Problem Sets', 'Problem Sets'], ['2 Midterm Exams', 'Midterm Exams'], ['1 Final Exam', 'Final Exam'],
    ['At least 2 Homework Assignments', 'Homework Assignments'], ['4 reading response essays (1 page)', 'Reading response essays'],
    ['exam2', 'Second exam'], ['Midterm II', '2nd midterm'], ['Blog post 3', 'Third blog post'],
    ['Exams 1', 'Exam 1'], ['Exam 1', 'Exams 1'], ['QuizzesII', 'Quiz 2'], ['Blog Posts 3', 'Blog Post 3'],
  ])('matches %s with %s in scoring and grounding', (name, label) => {
    const prediction = { components: [component(name)] };
    expect(scoreGrading(prediction, [component(label)])?.exact).toBe(true);
    expect(issues(prediction, label + ' 100%')).toEqual([]);
  });
  it('supports all ten spellings and rejects misplaced numbers', () => {
    const words = 'first second third fourth fifth sixth seventh eighth ninth tenth'.split(' ');
    const roman = 'i ii iii iv v vi vii viii ix x'.split(' ');
    words.forEach((word, i) => {
      const n = i + 1;
      for (const label of [word, n + (['st', 'nd', 'rd'][i] ?? 'th'), 'Exam' + n, 'Midterm ' + roman[i]]) {
        expect(ordinals(label)).toEqual([n]);
      }
    });
    expect(ordinals('Essay (second revision)')).toEqual([2]);
    for (const noun of ['exam', 'midterm', 'test', 'quiz', 'paper', 'essay', 'project', 'assignment',
      'homework', 'problem set', 'lab', 'blog post', 'post', 'presentation', 'report']) {
      expect(ordinals(noun + '4')).toEqual([4]);
    }
    expect(ordinals('10 quizzes (paper 1, exam II) at least 2, I agree')).toEqual([]);
    expect(scoreGrading({ components: [component('exam2')] }, [component('exam3')])?.exact).toBe(false);
    expect(scoreGrading({ components: [component('Exams 1')] }, [component('Exam 2')])?.exact).toBe(false);
  });
});

describe('group parts', () => {
  it.each([
    ['Exams', 70, 'Exams (70%): midterm 30%, final 40%'],
    ['Tests', 45, 'Three tests, 15% each'], ['Midterms', 43, 'Midterm 1 18%, Midterm 2 25%'],
  ] as const)('flags %s with a split hint', (name, weight, text) => {
    expect(checkGrading({ components: [component(name, weight)] }, text).issues)
      .toContainEqual({ code: 'group-has-parts', severity: 'fail', message: `Split '${name}' into its parts` });
  });
  it.each([['three tests', 'Test', 3, 15], ['3 tests', 'Test', 3, 15], ['two midterms', 'Midterm', 2, 25]] as const)(
    'repairs %s before escalation and can cite the parts', async (count, noun, n, each) => {
      const text = `${count}, ${each}% each\nPortfolio ${100 - n * each}%`;
      const out = await route(text, { components: [component(noun + 's', n * each), component('Portfolio', 100 - n * each)] });
      expect(out).toMatchObject({ escalated: false, finalReport: { status: 'checked' }, repairedItems: 1 });
      const parts = out.value!.components.slice(0, n);
      expect(parts.map(c => c.name)).toEqual(Array.from({ length: n }, (_, i) => noun + ' ' + (i + 1)));
      for (const c of parts) expect(evidenceFor(c, text)).toBe(text.split('\n')[0]);
    });
  it('recognizes a group across consecutive numbered rows and keeps independent categories', () => {
    expect(issues({ components: [component('Midterms', 43), component('Homework', 57)] },
      'Midterm 1 18%\nMidterm 2 25%\nHomework 57%')).toEqual(['group-has-parts']);
    expect(issues({ components: [component('Project', 50), component('Test', 30), component('Essay', 20)] },
      'Project 50%, Test 30%, Essay 20%')).toEqual([]);
    expect(issues({ components: [component('Project', 50), component('Test', 30), component('Essay', 20)] },
      'Project 50% (see rubric)\nTest 30%\nEssay 20%')).toEqual([]);
  });
  it('detects and repairs a breakdown supplied by the component name', async () => {
    const text = 'Midterms 43%\nPortfolio 57%';
    const grouped = { components: [component('Midterms (18% and 25% respectively)', 43), component('Portfolio', 57)] };
    expect(issues(grouped, text)).toEqual(['group-has-parts']);
    expect(issues({ components: [component('Midterms (18% and 24% respectively)', 43), component('Portfolio', 57)] }, text))
      .toEqual([]);
    const out = await route('Midterms 43%\nMidterm 1 18%\nPortfolio 57%\nMidterm 2 25%', grouped);
    expect(out).toMatchObject({ escalated: false, repairedItems: 1, finalReport: { status: 'checked' } });
    expect(out.value?.components).toEqual([component('Midterm 1', 18), component('Midterm 2', 25), component('Portfolio', 57)]);
  });
  it.each(['Midterms (18% and 25% respectively)', 'Midterms 43% (18% and 25% respectively)'])(
    'repairs unnamed parts and grounds them in %s', async row => {
      const text = row + '\nPortfolio 57%';
      const out = await route(text, { components: [component('Midterms (18% and 25% respectively)', 43), component('Portfolio', 57)] });
      expect(out).toMatchObject({ escalated: false, firstReport: { issues: [{ code: 'group-has-parts' }] },
        finalReport: { status: 'checked' }, repairedItems: 1 });
      expect(out.value?.components).toEqual([component('Midterm 1', 18), component('Midterm 2', 25), component('Portfolio', 57)]);
      for (const c of out.value!.components.slice(0, 2)) expect(evidenceFor(c, text)).toBe(row);
      expect(issues({ components: [component('Midterm 2', 18), component('Midterm 1', 25), component('Portfolio', 57)] }, text))
        .toEqual(['weight-not-bound', 'weight-not-bound']);
    });
  it('repairs named percentage parts before escalation', async () => {
    const out = await route('Exams (70%): midterm 30%, final 40%\nPortfolio 30%',
      { components: [component('Exams', 70), component('Portfolio', 30)] });
    expect(out).toMatchObject({ escalated: false, finalReport: { status: 'checked' }, repairedItems: 1 });
    expect(out.value?.components).toEqual([component('Midterm', 30), component('Final', 40), component('Portfolio', 30)]);
  });
  it('binds each rate to its own group in a shared line', async () => {
    const source = 'Two tests, 25% each; two papers, 10% each; Portfolio 30%';
    const out = await route(source, { components: [component('Tests', 50), component('Papers', 20), component('Portfolio', 30)] });
    expect(out).toMatchObject({ escalated: false, repairedItems: 2, finalReport: { status: 'checked' } });
    expect(out.value?.components.map(c => c.weight)).toEqual([25, 25, 10, 10, 30]);
  });
  it('requires an explicit matching count to repair and rejects swapped parts', async () => {
    const out = await route('Tests, 15% each\nPaper 55%', { components: [component('Tests', 45), component('Paper', 55)] });
    expect(out.escalated).toBe(true);
    expect(issues({ components: [component('Midterm 1', 25)] }, 'Midterm 1 18%, Midterm 2 25%')).toContain('weight-not-bound');
    expect(gradingPrompt('Quiz 100%')).toContain('List each separately weighted item');
  });
});

describe('points and unitless tables', () => {
  it('flags and repairs named points parts while retaining the original points total', async () => {
    const row = 'Exams—400 points (One Midterm worth 200 points and a final exam worth 200 points)';
    const text = row + '\nPortfolio 100 points';
    const out = await route(text, { components: [{ name: 'Exams', kind: 'exam', points: 400 },
      { name: 'Portfolio', kind: 'other', points: 100 }] });
    expect(out).toMatchObject({ escalated: false, firstReport: { issues: [{ code: 'group-has-parts' }] },
      finalReport: { status: 'checked' }, repairedItems: 1, value: { totalPoints: 500 } });
    expect(out.value?.components).toEqual([{ name: 'Midterm', kind: 'exam', points: 200, weight: 40 },
      { name: 'Final exam', kind: 'exam', points: 200, weight: 40 }, { name: 'Portfolio', kind: 'other', points: 100, weight: 20 }]);
    for (const c of out.value!.components.slice(0, 2)) expect(evidenceFor(c, text)).toBe(row);
  });
  it.each([1000, undefined])('converts written or inferred totals (%s) and retains point evidence', async totalPoints => {
    const text = 'Intro\nHomework\n300 points\nProject 700 pts' + (totalPoints ? '\nTotal 1,000 points' : '');
    const out = await route(text, { totalPoints, components: [{ name: 'Homework', kind: 'assignment', points: 300 },
      { name: 'Project', kind: 'project', points: 700 }] });
    expect(out).toMatchObject({ escalated: false, finalReport: { status: 'checked' }, value: { totalPoints: 1000 } });
    expect(out.value!.components.map(c => c.weight)).toEqual([30, 70]);
    expect(evidenceFor(out.value!.components[0], text)).toContain('300 points');
    expect(gradingPrompt(sliceSection(text, 'grading'))).toContain('totalPoints');
  });
  it('prefers percentages, rejects swapped points and invented totals, and checks rounded sums', () => {
    expect(sliceSection('Old 50 pts\nUnrelated\nGrading\nEssay 100%', 'grading')).not.toContain('pts');
    const text = 'Quiz 1 point\nEssay 2 points\nTotal 3 pts';
    const result = { components: [{ ...component('Quiz'), points: 1 }, { ...component('Essay'), points: 2 }] };
    expect(issues(result, text)).toEqual([]);
    expect(result.components.map(c => c.weight)).toEqual([33.33, 66.67]);
    expect(issues({ ...result, totalPoints: 4 }, text)).toEqual(expect.arrayContaining(['total-points', 'sum']));
    expect(issues({ ...result, totalPoints: 6 }, text.replace('Total 3', 'Total 6'))).toEqual(['sum']);
    expect(issues({ components: [{ ...component('Essay'), points: 1 }] }, text)).toContain('weight-not-bound');
  });
  it('applies the half-point tolerance after conversion', () => {
    const checked = (points: number) => issues({ totalPoints: 10000, components: [{ ...component('Studio'), points }] },
      'Studio ' + points + ' points\nTotal 10000 pts');
    expect(checked(9950)).toEqual([]);
    expect(checked(9949)).toEqual(['sum']);
  });
  it.each(['Type   %   Description', 'Component   Weight   Notes'])('reads a %s table and cites the original cells', header => {
    const text = ['Intro', header, 'Exams   60   Quiz 1 (25), Quiz 2 (35)', 'Portfolio   40   Design work',
      'End of table.', 'Room   99   Wednesday'].join('\n');
    const slice = sliceSection(text, 'grading');
    expect(slice).toContain(header);
    expect(slice).not.toContain('Room');
    const pred = { components: [component('Quiz 1', 25), component('Quiz 2', 35), component('Portfolio', 40)] };
    expect(issues(pred, slice)).toEqual([]);
    expect(evidenceFor(pred.components[0], slice)).toContain('Quiz 1 (25)');
    expect(issues({ components: [component('Exams', 60)] }, slice)).toContain('group-has-parts');
  });
});
