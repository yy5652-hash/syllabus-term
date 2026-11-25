// Browser evaluation runner (dev only): runs the labelled syllabus set through
// one routing mode and posts the per-case results back to the dev server.
//   /eval.html?set=holdout&mode=hybrid|device|cloud&limit=40&tag=v2
import { cloud, hybrid } from '../firebase';
import { readSyllabus } from '../app/pdf';
import type { CheckReport, RemovedItem } from '../core/checks';
import { inferTerm } from '../core/dates';
import { extractTermPlan, type RouterOptions } from '../core/router';
import { scoreDates, scoreGrading, summarize, type CaseResult, type Label } from './score';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'hybrid';
const holdout = q.get('set') === 'holdout';
const limit = Number(q.get('limit') ?? 1000);
const only = q.get('only');
const tag = q.get('tag') ?? 'run';
const out = document.getElementById('out')!;
const log = (s: string) => (out.textContent = s + '\n' + out.textContent);
const w = window as unknown as { __evalDone?: boolean; __evalSummary?: unknown };

type EvalRow = CaseResult & Required<Pick<CaseResult, 'gradingValue' | 'datesValue' | 'datesStatus'>> & {
  gradingStatus: CheckReport['status'];
  removed: RemovedItem[];
  termSource: 'inferred' | 'label' | null;
};

async function fetchData(path: string) {
  const response = await fetch(`/evaldata/${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  return response;
}

async function syllabusText(id: string) {
  if (!holdout) return (await fetchData(`cases/${encodeURIComponent(id)}.txt`)).text();
  const pdf = await fetchData(`holdout/pdf/${encodeURIComponent(id)}.pdf`);
  return readSyllabus(new File([await pdf.blob()], `${id}.pdf`, { type: 'application/pdf' }));
}

function options(): RouterOptions {
  if (mode === 'cloud') return { hybrid: cloud, cloud, escalate: false };
  if (mode === 'device') return { hybrid, cloud, escalate: false };
  return { hybrid, cloud, escalate: true };
}

async function main() {
  w.__evalDone = false;
  const labels: Label[] = (await (await fetchData(holdout ? 'holdout/labels.jsonl' : 'labels.jsonl')).text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((l: Label) => !only || only.split(',').includes(l.id))
    .slice(0, limit);
  const rows: EvalRow[] = [];
  for (const [i, lab] of labels.entries()) {
    const t0 = performance.now();
    let text = '';
    let termSource: EvalRow['termSource'] = null;
    try {
      text = await syllabusText(lab.id);
      const inferred = holdout ? inferTerm(text) : null;
      const term = inferred ?? { start: lab.term_start, end: lab.term_end };
      termSource = inferred ? 'inferred' : 'label';
      const plan = await extractTermPlan(text, Number(term.start.slice(0, 4)), { ...options(), term });
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
        gradingStatus: plan.grading.finalReport.status,
        datesStatus: plan.schedule.finalReport.status,
        datesChecksOk: plan.schedule.finalReport.ok,
        charsToCloud: plan.grading.charsSentToCloud + plan.schedule.charsSentToCloud,
        chars: text.length,
        ms: Math.round(performance.now() - t0),
        // For failure analysis: which checks fired on the first answer, and what was returned.
        gradingFirstIssues: plan.grading.firstReport.issues.map((x) => x.code),
        datesFirstIssues: plan.schedule.firstReport.issues.map((x) => `${x.code}:${x.message}`),
        gradingValue: plan.grading.value,
        datesValue: plan.schedule.value,
        removed: plan.schedule.removed,
        termSource,
      });
    } catch (e) {
      rows.push({ id: lab.id, mode, gradingEligible: lab.grading !== null, datesEligible: lab.dates !== null,
        grading: null, dates: null, gradingValue: null, datesValue: null, removed: [], termSource,
        gradingSource: 'error', datesSource: 'error', gradingEscalated: false, datesEscalated: false,
        gradingChecksOk: false, datesChecksOk: false, gradingStatus: 'failed', datesStatus: 'failed',
        charsToCloud: 0, chars: text.length, ms: Math.round(performance.now() - t0),
        error: String(e instanceof Error ? e.message : e).slice(0, 300) });
    }
    const r = rows[rows.length - 1];
    log(`${i + 1}/${labels.length} ${r.id} g=${r.grading?.exact ?? '-'} d=${r.dates ? r.dates.recall.toFixed(2) : '-'} ${r.gradingSource}/${r.datesSource} ${r.ms}ms ${r.error ?? ''}`);
  }
  const summary = summarize(rows);
  w.__evalSummary = summary;
  const name = `${tag}-${mode}${holdout ? '-holdout' : ''}`;
  const response = await fetch(`/evaldata/results?name=${encodeURIComponent(name)}`, {
    method: 'POST', body: JSON.stringify({ mode, tag, at: new Date().toISOString(), summary, rows }, null, 2),
  });
  if (!response.ok) throw new Error(`Could not save ${name} (HTTP ${response.status}).`);
  log('SUMMARY ' + JSON.stringify(summary));
  w.__evalDone = true;
}

const start = document.querySelector<HTMLButtonElement>('#start')!;
start.onclick = async () => {
  start.disabled = true;
  try { await main(); }
  catch (error) { log(String(error)); }
  finally { start.disabled = false; }
};
