// Dev-only page: download Gemini Nano, then run the verify-then-escalate
// pipeline on a sample syllabus and print where each section was answered.
import { cloud, hybrid, prepareOnDevice } from './firebase';
import { extractTermPlan } from './core/router';
import { SAMPLE } from './app/sample';

const out = document.getElementById('out')!;
const log = (s: string) => (out.textContent += '\n' + s);
(window as unknown as { __log: string[] }).__log = [];

document.getElementById('prep')!.onclick = async () => {
  out.textContent = 'preparing…';
  try {
    const st = await prepareOnDevice((p) => (out.textContent = `downloading ${(p * 100).toFixed(1)}%`));
    log('availability: ' + st);
  } catch (e) {
    log('prepare error: ' + (e as Error).message);
  }
};

document.getElementById('run')!.onclick = async () => {
  out.textContent = 'running…';
  try {
    const plan = await extractTermPlan(SAMPLE, 2026, { hybrid, cloud, term: { start: '2026-09-01', end: '2026-12-23' } });
    const s = JSON.stringify(plan, null, 2);
    log(s);
    (window as unknown as { __plan: unknown }).__plan = plan;
  } catch (e) {
    log('run error: ' + (e as Error).message);
  }
};
