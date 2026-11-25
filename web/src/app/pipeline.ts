import type { Term } from '../core/checks';
import { extractTermPlan, type Runner, type SectionOutcome } from '../core/router';
import { SCHEDULE_SCHEMA, type GradingResult, type ScheduleResult } from '../core/schema';

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
  const wrap = (runner: Runner, state: 'reading' | 'verifying'): Runner => (prompt, schema) => {
    const section = schema === SCHEDULE_SCHEMA ? 'schedule' : 'grading';
    onProgress({ section, state });
    return runner(prompt, schema);
  };
  const hybrid = wrap(runners.hybrid, 'reading');
  const cloud = runners.hybrid === runners.cloud ? hybrid : wrap(runners.cloud, 'verifying');
  const plan = await extractTermPlan(text, year, { hybrid, cloud, term, escalate });
  onProgress({ section: 'grading', state: 'done', outcome: plan.grading });
  onProgress({ section: 'schedule', state: 'done', outcome: plan.schedule });
  return plan;
}
