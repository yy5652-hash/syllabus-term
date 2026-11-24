import { checkGrading, checkSchedule, parseJson, type Term } from '../core/checks';
import { extractTermPlan, sliceSection, type Runner, type SectionOutcome } from '../core/router';
import { GRADING_SCHEMA, type GradingResult, type ScheduleResult } from '../core/schema';

export type Section = 'grading' | 'schedule';
export type Outcome = SectionOutcome<GradingResult | ScheduleResult>;
export interface SectionProgress {
  section: Section;
  state: 'waiting' | 'reading' | 'verifying' | 'done' | 'error';
  outcome?: Outcome;
}

/** Observe the existing router at its Runner boundary, without changing its decisions. */
export async function extractWithProgress(text: string, year: number, runners: { hybrid: Runner; cloud: Runner },
  term: Term | undefined, onProgress: (progress: SectionProgress) => void, escalate = true) {
  const starts: Partial<Record<Section, number>> = {};
  const firsts: Partial<Record<Section, Outcome>> = {};
  const wrap = (runner: Runner, isCloud: boolean): Runner => async (prompt, schema) => {
    const section = schema === GRADING_SCHEMA ? 'grading' : 'schedule';
    const slice = sliceSection(text, section);
    if (!isCloud) {
      starts[section] = performance.now();
      onProgress({ section, state: 'reading' });
    }
    try {
      const answer = await runner(prompt, schema);
      const value = parseJson<GradingResult | ScheduleResult>(answer.text);
      const report = section === 'grading' ? checkGrading(value as GradingResult | null, slice)
        : checkSchedule(value as ScheduleResult | null, slice, term);
      const first = firsts[section];
      const outcome: Outcome = {
        section, value, firstSource: first?.firstSource ?? answer.source, finalSource: answer.source,
        escalated: isCloud, firstReport: first?.firstReport ?? report, finalReport: report,
        charsSentToCloud: answer.source === 'in_cloud' ? slice.length : 0,
        ms: Math.round(performance.now() - starts[section]!), repairedItems: 0,
      };
      if (!isCloud) firsts[section] = outcome;
      onProgress({ section, state: !isCloud && !report.ok && answer.source === 'on_device' ? 'verifying' : 'done', outcome });
      return answer;
    } catch (error) {
      onProgress({ section, state: 'error' });
      throw error;
    }
  };
  const plan = await extractTermPlan(text, year, { hybrid: wrap(runners.hybrid, false), cloud: wrap(runners.cloud, true), term, escalate });
  onProgress({ section: 'grading', state: 'done', outcome: plan.grading });
  onProgress({ section: 'schedule', state: 'done', outcome: plan.schedule });
  return plan;
}
