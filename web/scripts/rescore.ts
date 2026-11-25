// Run from web/: tsx scripts/rescore.ts ../eval/results/v7-*.json
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { scoreDates, scoreGrading, summarize, type CaseResult, type Label } from '../src/evalkit/score';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass one or more saved evaluation result files.');
const evalDir = resolve(__dirname, '../../eval');
function labelsFor(path: string) {
  const labels = readFileSync(resolve(evalDir, path), 'utf8').trim().split(/\r?\n/).map(s => JSON.parse(s) as Label);
  return new Map(labels.map(l => [l.id, l]));
}

const percent = (n: number) => (100 * n).toFixed(2) + '%';
const results = files.map(file => {
  const saved: { rows: CaseResult[] } = JSON.parse(readFileSync(file, 'utf8'));
  const labels = labelsFor(basename(file).includes('holdout') ? 'holdout/labels.jsonl' : 'labels.jsonl');
  // Preserve predictions, check outcomes, bonus flags and error denominators.
  const rows = saved.rows.map(row => {
    const lab = labels.get(row.id);
    if (!lab) throw new Error(`Missing label for ${row.id} in ${file}`);
    if (row.error) return row;
    if (row.gradingValue === undefined || row.datesValue === undefined) throw new Error(`Missing predictions for ${row.id}`);
    return { ...row, grading: scoreGrading(row.gradingValue, lab.grading), dates: scoreDates(row.datesValue, lab.dates) };
  });
  return { file: basename(file), before: summarize(saved.rows), after: summarize(rows) };
});

const metrics = ['gradingExact', 'gradingWeightsOnly', 'datesExact', 'datesRecall', 'datesPrecision',
  'datesPairRecall', 'datesPairPrecision', 'datesChecked'] as const;
console.log('| File | Cases | Errors | Grading n | Dates n | ' + metrics.join(' | ') + ' |');
console.log('|' + '---|'.repeat(5 + metrics.length));
for (const { file, before, after } of results) {
  const cells = metrics.map(key => percent(before[key]) + ' → ' + percent(after[key]));
  console.log('| ' + [file, before.cases, before.errors, before.gradingCases, before.datesCases, ...cells].join(' | ') + ' |');
}
