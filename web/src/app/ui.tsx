import { useEffect, useRef, type ReactNode } from 'react';
import type { CheckReport, RemovedItem } from '../core/checks';
import type { Source } from '../core/router';
import type { Outcome, SectionProgress } from './pipeline';

export function Icon({ name, size = 20 }: { name: 'book' | 'upload' | 'arrow' | 'sun' | 'moon' | 'close' | 'calendar' | 'trash'; size?: number }) {
  const paths = {
    book: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /><path d="M12 5v15" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal card" onCancel={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="how-title">
    <div className="section-heading"><h2 id="how-title">A second look, only when needed.</h2><button className="icon-button" aria-label="Close explanation" onClick={onClose}><Icon name="close" /></button></div>
    {children}
    <button className="primary" onClick={onClose}>Got it</button>
  </dialog>;
}

const sourceLabel: Record<Source, string> = {
  on_device: 'Read on device', in_cloud: 'Read in cloud', unknown: 'Read with a fallback',
};

const removalReasons: Record<string, string> = {
  'date-format': 'The date format is invalid.',
  'date-not-in-text': 'The date could not be found in the syllabus text.',
  'date-not-bound': 'The date could not be linked to this event.',
  'year-mismatch': 'The year differs from the written date.',
};

export function RemovedDates({ removed }: { removed: RemovedItem[] }) {
  if (!removed.length) return null;
  return <div className="not-added"><strong>Not added</strong><ul>{removed.map(({ item, reason }, i) =>
    <li key={i}>{item.label} · {item.date} — {removalReasons[reason] ?? reason}</li>)}</ul></div>;
}

export function ReportFeedback({ report }: { report: CheckReport }) {
  if (report.status === 'checked') return null;
  const review = report.status === 'review';
  const issues = review ? report.issues.filter(i => i.severity === 'review') : report.issues;
  return <div className={`warning${review ? ' review' : ''}`}><strong>{review ? 'Needs your review' : 'Review before relying on this plan'}</strong>
    <ul>{issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>;
}

function outcomeLabel(outcome: Outcome): string {
  if (outcome.finalReport.status !== 'checked' || outcome.finalSource === 'unknown') return sourceLabel[outcome.finalSource];
  return outcome.finalSource === 'on_device' ? 'Checked on device ✓' : 'Checked in cloud ✓';
}

export function ProgressRow({ progress, sourceChars, cloudOnly = false }: { progress: SectionProgress; sourceChars: number; cloudOnly?: boolean }) {
  const { section, state, outcome } = progress;
  const active = state === 'reading' || state === 'verifying';
  const done = state === 'done' ? outcome : undefined;
  const label = state === 'waiting' ? 'Waiting for the previous section'
    : state === 'reading' ? cloudOnly ? 'Reading in the cloud…' : 'Reading on your device…'
    : state === 'verifying' ? 'Check failed → verifying in cloud…'
    : state === 'error' ? 'Could not finish this section'
    : done ? outcomeLabel(done) : '';
  return <div className={`progress-row ${state}`}>
    <div className="progress-symbol" aria-hidden="true">{active ? <span className="spinner" /> : done?.finalReport.status === 'checked' && done.finalSource !== 'unknown' ? '✓' : state === 'error' ? '!' : <span className="small-dot" />}</div>
    <div className="progress-copy"><div className="row-spread"><strong>{section === 'grading' ? 'Grading' : 'Dates'}</strong>{state === 'done' && outcome && <span className="meta">{(outcome.ms / 1000).toFixed(1)} s</span>}</div>
      <p>{label}</p>
      {outcome && outcome.charsSentToCloud > 0 && <p className="meta">{outcome.charsSentToCloud.toLocaleString()} characters sent to the cloud (of {sourceChars.toLocaleString()} in the syllabus)</p>}
      {outcome && outcome.firstReport.issues.length > 0 && <details><summary>View {outcome.firstReport.issues.length} initial check message{outcome.firstReport.issues.length === 1 ? '' : 's'}</summary><ul>{outcome.firstReport.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></details>}
      {done && <><ReportFeedback report={done.finalReport} />
        {done.escalationError && <p className="meta">The cloud retry did not finish.</p>}
        {section === 'schedule' && <RemovedDates removed={done.removed} />}</>}
    </div>
  </div>;
}
