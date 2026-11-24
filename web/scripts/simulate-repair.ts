// Offline what-if on a saved eval run: drop schedule items that fail item-level
// checks (ungrounded date / outside term / bad format / generic label) and rescore.
import { readFileSync } from 'node:fs';
import { checkSchedule } from '../src/core/checks';
import { sliceSection } from '../src/core/router';
import { scoreDates, type Label } from '../src/evalkit/score';
import type { ScheduleResult } from '../src/core/schema';

const run = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const labels = new Map<string, Label>(readFileSync('../eval/labels.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.id, o]; }));
let pB = 0, rB = 0, pA = 0, rA = 0, n = 0, okAfter = 0, emptied = 0;
for (const row of run.rows) {
  const lab = labels.get(row.id)!;
  const v = row.datesValue as ScheduleResult | null;
  const text = readFileSync(`../eval/cases/${row.id}.txt`, 'utf8');
  const s = sliceSection(text, 'schedule');
  const term = { start: lab.term_start, end: lab.term_end };
  const kept = (v?.items ?? []).filter((it) => checkSchedule({ items: [it] }, s, term).ok);
  if ((v?.items?.length ?? 0) > 0 && kept.length === 0) emptied++;
  if (checkSchedule({ items: kept }, s, term).ok) okAfter++;
  if (!lab.dates) continue;
  const b = scoreDates(v, lab.dates), a = scoreDates({ items: kept }, lab.dates);
  pB += b.precision; rB += b.recall; pA += a.precision; rA += a.recall; n++;
}
console.log(`labelled ${n}: before P/R ${(pB / n).toFixed(3)}/${(rB / n).toFixed(3)}  after drop P/R ${(pA / n).toFixed(3)}/${(rA / n).toFixed(3)}`);
console.log(`cases passing after drop: ${okAfter}/${run.rows.length}; emptied by drop: ${emptied}`);
