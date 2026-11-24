import { useEffect, useRef, type ReactNode } from 'react';
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

function outcomeLabel(outcome: Outcome): string {
  if (outcome.escalationError) return 'Cloud unavailable — kept the on-device answer, please review';
  if (!outcome.finalReport.ok) return 'Checks still need your review';
  if (outcome.repairedItems) {
    const n = outcome.repairedItems;
    return `Checked on device ✓ · removed ${n} date${n === 1 ? '' : 's'} not in your syllabus`;
  }
  if (outcome.escalated) {
    const count = outcome.firstReport.issues.filter((i) => i.severity === 'fail').length;
    return `${count} check${count === 1 ? '' : 's'} failed → verified in cloud`;
  }
  return outcome.finalSource === 'on_device' ? 'Checked on device ✓' : 'Checked in cloud ✓';
}

export function ProgressRow({ progress, sourceChars, cloudOnly = false }: { progress: SectionProgress; sourceChars: number; cloudOnly?: boolean }) {
  const { section, state, outcome } = progress;
  const active = state === 'reading' || state === 'verifying';
  const label = state === 'waiting' ? 'Waiting for the previous section'
    : state === 'reading' ? cloudOnly ? 'Reading in the cloud…' : 'Reading on your device…'
    : state === 'verifying' ? 'Check failed → verifying in cloud…'
    : state === 'error' ? 'Could not finish this section'
    : outcome ? outcomeLabel(outcome) : '';
  return <div className={`progress-row ${state}`}>
    <div className="progress-symbol" aria-hidden="true">{active ? <span className="spinner" /> : state === 'done' && outcome?.finalReport.ok ? '✓' : state === 'error' ? '!' : <span className="small-dot" />}</div>
    <div className="progress-copy"><div className="row-spread"><strong>{section === 'grading' ? 'Grading' : 'Dates'}</strong>{state === 'done' && outcome && <span className="meta">{(outcome.ms / 1000).toFixed(1)} s</span>}</div>
      <p>{label}</p>
      {outcome && outcome.charsSentToCloud > 0 && <p className="meta">{outcome.charsSentToCloud.toLocaleString()} characters sent to the cloud (of {sourceChars.toLocaleString()} in the syllabus)</p>}
      {outcome && outcome.firstReport.issues.length > 0 && <details><summary>View {outcome.firstReport.issues.length} initial check message{outcome.firstReport.issues.length === 1 ? '' : 's'}</summary><ul>{outcome.firstReport.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></details>}
      {state === 'done' && outcome && !outcome.finalReport.ok && <div className="warning"><strong>Review before relying on this plan.</strong><ul>{outcome.finalReport.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>}
    </div>
  </div>;
}
