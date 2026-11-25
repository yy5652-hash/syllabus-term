import { isRealDate, type CheckReport, type RemovedItem, type Term } from '../core/checks';
import type { SectionOutcome, TermPlan } from '../core/router';
import type { GradingComponent } from '../core/schema';
import { DEFAULT_THRESHOLDS } from './grade';
import type { CalendarItem } from './ics';

export interface GradingRow extends GradingComponent { id: string }

export interface Course {
  id: string;
  title: string;
  sourceText: string;
  term?: Term;
  components: GradingRow[];
  dates: CalendarItem[];
  plan: TermPlan;
  scores: Record<string, string>;
  target: string;
  thresholds: Record<string, string>;
}

type StoredReport = Omit<CheckReport, 'status'> & Partial<Pick<CheckReport, 'status'>>;
type StoredOutcome<T> = Omit<SectionOutcome<T>, 'firstReport' | 'finalReport' | 'removed' | 'repairedItems'> & {
  firstReport: StoredReport;
  finalReport: StoredReport;
  removed?: RemovedItem[];
  repairedItems?: number;
};
type StoredCourse = Omit<Course, 'components' | 'plan' | 'scores' | 'target' | 'thresholds'> & {
  components: (GradingComponent & { id?: string })[];
  plan: {
    grading: StoredOutcome<NonNullable<TermPlan['grading']['value']>>;
    schedule: StoredOutcome<NonNullable<TermPlan['schedule']['value']>>;
    sourceChars: number;
  };
} & Partial<Pick<Course, 'scores' | 'target' | 'thresholds'>>;

export function newCalculator(): Pick<Course, 'scores' | 'target' | 'thresholds'> {
  return { scores: {}, target: 'A', thresholds: Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([letter, value]) => [letter, String(value)])) };
}

export const COMPONENT_KINDS = ['exam', 'quiz', 'assignment', 'project', 'participation', 'other'] as const;
export const DATE_KINDS = ['exam', 'quiz', 'deadline', 'other'] as const;
const KEY = 'syllabus-term:courses:v1';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stringValues = (v: unknown) => record(v) && Object.values(v).every(value => typeof value === 'string');
const optionalNumber = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));
const grading = (v: unknown): boolean => record(v) && typeof v.name === 'string' && typeof v.weight === 'number' &&
  Number.isFinite(v.weight) && optionalNumber(v.points) && COMPONENT_KINDS.includes(v.kind as GradingComponent['kind']) &&
  (v.bonus === undefined || typeof v.bonus === 'boolean');
const date = (v: unknown): boolean => record(v) && typeof v.label === 'string' && typeof v.date === 'string' &&
  DATE_KINDS.includes(v.kind as CalendarItem['kind']);
const report = (v: unknown): boolean => record(v) && typeof v.ok === 'boolean' && Array.isArray(v.issues) &&
  (v.status === undefined || ['checked', 'review', 'failed'].includes(String(v.status))) &&
  v.issues.every((i) => record(i) && typeof i.message === 'string' && typeof i.code === 'string' && ['fail', 'warn', 'review'].includes(String(i.severity)));
function outcome(v: unknown, kind: 'grading' | 'schedule'): boolean {
  if (!record(v)) return false;
  const value = v.value;
  const sources = ['on_device', 'in_cloud', 'unknown'];
  return v.section === kind && sources.includes(String(v.firstSource)) &&
    sources.includes(String(v.finalSource)) && typeof v.escalated === 'boolean' &&
    typeof v.ms === 'number' && typeof v.charsSentToCloud === 'number' && report(v.firstReport) && report(v.finalReport) &&
    (v.repairedItems === undefined || typeof v.repairedItems === 'number') &&
    (v.removed === undefined || (Array.isArray(v.removed) && v.removed.every(r => record(r) && date(r.item) && typeof r.reason === 'string'))) &&
    (value === null || (record(value) && (kind === 'grading' ? optionalNumber(value.totalPoints) && Array.isArray(value.components) && value.components.every(grading)
      : Array.isArray(value.items) && value.items.every(date))));
}
function isStoredCourse(v: unknown): v is StoredCourse {
  return record(v) && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.sourceText === 'string' &&
    Array.isArray(v.components) && v.components.every(c => record(c) && grading(c) && (c.id === undefined || typeof c.id === 'string')) &&
    (v.scores === undefined || stringValues(v.scores)) && (v.target === undefined || typeof v.target === 'string') &&
    (v.thresholds === undefined || stringValues(v.thresholds)) && Array.isArray(v.dates) &&
    v.dates.every((d) => date(d) && record(d) && typeof d.id === 'string') &&
    (v.term === undefined || (record(v.term) && typeof v.term.start === 'string' && typeof v.term.end === 'string' &&
      isRealDate(v.term.start) && isRealDate(v.term.end))) && record(v.plan) && typeof v.plan.sourceChars === 'number' &&
    outcome(v.plan.grading, 'grading') && outcome(v.plan.schedule, 'schedule');
}

function restoreOutcome<T>(stored: StoredOutcome<T>): SectionOutcome<T> {
  const restoreReport = (r: StoredReport): CheckReport => ({ ...r,
    status: r.status ?? (!r.ok ? 'failed' : r.issues.some(i => i.severity === 'review') ? 'review' : 'checked'),
  });
  return { ...stored, firstReport: restoreReport(stored.firstReport), finalReport: restoreReport(stored.finalReport),
    removed: stored.removed ?? [], repairedItems: stored.repairedItems ?? stored.removed?.length ?? 0 };
}

function restoreCourse(stored: StoredCourse): Course {
  const defaults = newCalculator();
  return { ...stored,
    components: stored.components.map(c => ({ ...c, id: c.id ?? crypto.randomUUID() })),
    scores: stored.scores ?? defaults.scores,
    target: stored.target && Object.hasOwn(defaults.thresholds, stored.target) ? stored.target : defaults.target,
    thresholds: { ...defaults.thresholds, ...stored.thresholds },
    plan: { ...stored.plan, grading: restoreOutcome(stored.plan.grading), schedule: restoreOutcome(stored.plan.schedule) },
  };
}

export function loadCourses(): { courses: Course[]; error: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { courses: [], error: '' };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStoredCourse)) throw new Error('Invalid saved courses');
    return { courses: parsed.map(restoreCourse), error: '' };
  } catch {
    return { courses: [], error: 'Saved courses could not be loaded. You can still make and export a plan in this tab.' };
  }
}

export function saveCourses(courses: Course[]): string {
  try { localStorage.setItem(KEY, JSON.stringify(courses)); return ''; }
  catch { return 'Your browser could not save these courses. Your plan is still available in this tab; export it before closing.'; }
}

export type Theme = 'system' | 'light' | 'dark';
export function loadTheme(): Theme {
  try { const value = localStorage.getItem('syllabus-term:theme'); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return 'system'; }
}
export function saveTheme(theme: Theme): void {
  try { localStorage.setItem('syllabus-term:theme', theme); } catch { /* Theme still works in this tab. */ }
}

export function defaultTerm(now = new Date()): Term {
  const year = now.getFullYear();
  if (now.getMonth() >= 8) return { start: `${year}-09-01`, end: `${year}-12-23` };
  if (now.getMonth() <= 4) return { start: `${year}-01-12`, end: `${year}-05-31` };
  return { start: `${year}-06-01`, end: `${year}-08-31` };
}

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
