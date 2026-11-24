// Browser evaluation runner (dev only): runs the labelled syllabus set through
// one routing mode and posts the per-case results back to the dev server.
//   /eval.html?mode=hybrid|device|cloud&limit=40&tag=v1
import { cloud, hybrid } from '../firebase';
import { extractTermPlan, type RouterOptions } from '../core/router';
import { scoreDates, scoreGrading, summarize, type CaseResult, type Label } from './score';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'hybrid';
const limit = Number(q.get('limit') ?? 1000);
const only = q.get('only');
const tag = q.get('tag') ?? 'run';
const out = document.getElementById('out')!;
const log = (s: string) => (out.textContent = s + '\n' + out.textContent);
const w = window as unknown as { __evalDone?: boolean; __evalSummary?: unknown };

function options(): RouterOptions {
  if (mode === 'cloud') return { hybrid: cloud, cloud, escalate: false };
  if (mode === 'device') return { hybrid, cloud, escalate: false };
  return { hybrid, cloud, escalate: true };
}

async function main() {
  const labels: Label[] = (await (await fetch('/evaldata/labels.jsonl')).text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((l: Label) => !only || only.split(',').includes(l.id))
    .slice(0, limit);
  const rows: CaseResult[] = [];
  for (const [i, lab] of labels.entries()) {
    const text = await (await fetch(`/evaldata/cases/${lab.id}.txt`)).text();
    const t0 = performance.now();
    try {
      const plan = await extractTermPlan(text, lab.year, { ...options(), term: { start: lab.term_start, end: lab.term_end } });
      rows.push({
        id: lab.id,
        mode,
        grading: scoreGrading(plan.grading.value, lab.grading),
        dates: scoreDates(plan.schedule.value, lab.dates),
        gradingSource: plan.grading.finalSource,
        datesSource: plan.schedule.finalSource,
        gradingEscalated: plan.grading.escalated,
        datesEscalated: plan.schedule.escalated,
        gradingChecksOk: plan.grading.finalReport.ok,
        datesChecksOk: plan.schedule.finalReport.ok,
        charsToCloud: plan.grading.charsSentToCloud + plan.schedule.charsSentToCloud,
        chars: text.length,
        ms: Math.round(performance.now() - t0),
        // For failure analysis: which checks fired on the first answer, and what was returned.
        gradingFirstIssues: plan.grading.firstReport.issues.map((x) => x.code),
        datesFirstIssues: plan.schedule.firstReport.issues.map((x) => `${x.code}:${x.message}`),
        gradingValue: plan.grading.value,
        datesValue: plan.schedule.value,
      });
    } catch (e) {
      rows.push({ id: lab.id, mode, grading: null, dates: null, gradingSource: 'error', datesSource: 'error', gradingEscalated: false, datesEscalated: false, gradingChecksOk: false, datesChecksOk: false, charsToCloud: 0, chars: text.length, ms: Math.round(performance.now() - t0), error: String((e as Error).message).slice(0, 300) });
    }
    const r = rows[rows.length - 1];
    log(`${i + 1}/${labels.length} ${r.id} g=${r.grading?.exact ?? '-'} d=${r.dates ? r.dates.recall.toFixed(2) : '-'} ${r.gradingSource}/${r.datesSource} ${r.ms}ms ${r.error ?? ''}`);
  }
  const summary = summarize(rows);
  w.__evalSummary = summary;
  await fetch(`/evaldata/results?name=${encodeURIComponent(`${tag}-${mode}`)}`, { method: 'POST', body: JSON.stringify({ mode, tag, at: new Date().toISOString(), summary, rows }, null, 2) });
  log('SUMMARY ' + JSON.stringify(summary));
  w.__evalDone = true;
}

document.getElementById('start')!.onclick = () => void main();
