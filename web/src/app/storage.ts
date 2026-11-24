import { isRealDate, type Term } from '../core/checks';
import type { TermPlan } from '../core/router';
import type { GradingComponent } from '../core/schema';
import type { CalendarItem } from './ics';

export interface Course {
  id: string;
  title: string;
  sourceText: string;
  term?: Term;
  components: GradingComponent[];
  dates: CalendarItem[];
  plan: TermPlan;
}

export const COMPONENT_KINDS = ['exam', 'quiz', 'assignment', 'project', 'participation', 'other'] as const;
export const DATE_KINDS = ['exam', 'quiz', 'deadline', 'other'] as const;
const KEY = 'syllabus-term:courses:v1';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const grading = (v: unknown): boolean => record(v) && typeof v.name === 'string' && typeof v.weight === 'number' &&
  Number.isFinite(v.weight) && COMPONENT_KINDS.includes(v.kind as GradingComponent['kind']);
const date = (v: unknown): boolean => record(v) && typeof v.label === 'string' && typeof v.date === 'string' &&
  DATE_KINDS.includes(v.kind as CalendarItem['kind']);
const report = (v: unknown): boolean => record(v) && typeof v.ok === 'boolean' && Array.isArray(v.issues) &&
  v.issues.every((i) => record(i) && typeof i.message === 'string' && typeof i.code === 'string' && ['fail', 'warn'].includes(String(i.severity)));
function outcome(v: unknown, kind: 'grading' | 'schedule'): boolean {
  if (!record(v)) return false;
  const value = v.value;
  return v.section === kind && ['on_device', 'in_cloud'].includes(String(v.firstSource)) &&
    ['on_device', 'in_cloud'].includes(String(v.finalSource)) && typeof v.escalated === 'boolean' &&
    typeof v.ms === 'number' && typeof v.charsSentToCloud === 'number' && report(v.firstReport) && report(v.finalReport) &&
    (value === null || (record(value) && (kind === 'grading' ? Array.isArray(value.components) && value.components.every(grading)
      : Array.isArray(value.items) && value.items.every(date))));
}
function isCourse(v: unknown): v is Course {
  return record(v) && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.sourceText === 'string' &&
    Array.isArray(v.components) && v.components.every(grading) && Array.isArray(v.dates) &&
    v.dates.every((d) => date(d) && record(d) && typeof d.id === 'string') &&
    (v.term === undefined || (record(v.term) && typeof v.term.start === 'string' && typeof v.term.end === 'string' &&
      isRealDate(v.term.start) && isRealDate(v.term.end))) && record(v.plan) && typeof v.plan.sourceChars === 'number' &&
    outcome(v.plan.grading, 'grading') && outcome(v.plan.schedule, 'schedule');
}

export function loadCourses(): { courses: Course[]; error: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { courses: [], error: '' };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isCourse)) throw new Error('Invalid saved courses');
    return { courses: parsed, error: '' };
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
