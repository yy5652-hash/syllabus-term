import { useState } from 'react';
import { checkGrading, checkSchedule, isRealDate } from '../core/checks';
import type { DatedItem, GradingComponent } from '../core/schema';
import { calculateGrade, DEFAULT_THRESHOLDS } from './grade';
import { downloadCalendar, googleCalendarUrl, type CalendarItem } from './ics';
import { COMPONENT_KINDS, DATE_KINDS, type Course } from './storage';
import { Icon, ProgressRow } from './ui';

export const formatDate = (date: string) => isRealDate(date)
  ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
  : 'Choose a date';

export function CoursePlan({ course, onChange, onSave, saved }: {
  course: Course; onChange: (course: Course) => void; onSave: () => void; saved: boolean;
}) {
  const [scores, setScores] = useState<string[]>([]);
  const [target, setTarget] = useState('A');
  const [thresholds, setThresholds] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([k, v]) => [k, String(v)])));
  const [calendarError, setCalendarError] = useState('');
  const gradingReport = checkGrading({ components: course.components }, course.sourceText);
  const scheduleReport = checkSchedule({ items: course.dates }, course.sourceText, course.term);
  const sum = course.components.reduce((total, c) => total + c.weight, 0);
  const sumOff = Math.abs(sum - 100) > 0.000001;
  const values = Object.values(thresholds).map((v) => v.trim() ? Number(v) : NaN);
  const thresholdsValid = values.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 100 && (i === 0 || v <= values[i - 1]));
  const calculation = calculateGrade(course.components, course.components.map((_, i) => scores[i]?.trim() ? Number(scores[i]) : null),
    thresholdsValid ? Number(thresholds[target]) : NaN);
  const editComponent = (index: number, patch: Partial<GradingComponent>) => {
    onChange({ ...course, components: course.components.map((c, i) => i === index ? { ...c, ...patch } : c) });
  };
  const editDate = (id: string, patch: Partial<DatedItem>) => {
    onChange({ ...course, dates: course.dates.map((d) => d.id === id ? { ...d, ...patch } : d) });
  };
  const exportable = (item: CalendarItem) => isRealDate(item.date) && item.date !== '9999-12-31' && !!item.label.trim();
  const exportDates = (items: CalendarItem[]) => {
    try { downloadCalendar(course.id, course.title, items); setCalendarError(''); }
    catch (error) { setCalendarError(error instanceof Error ? error.message : 'Calendar export failed. Try again.'); }
  };
  return <div className="result-view">
    <div className="result-top">
      <div><label className="sr-only" htmlFor="course-title">Course title</label>
        <input id="course-title" className="course-title" value={course.title} onChange={(e) => onChange({ ...course, title: e.target.value })} />
        <p className="muted">{course.term ? `${formatDate(course.term.start)} — ${formatDate(course.term.end)}` : 'No term date filter'} · Review and edit your plan below.</p></div>
      <button className="primary" disabled={!course.title.trim() || saved} onClick={onSave}>{saved ? 'Saved to My courses ✓' : 'Save to My courses'}{!saved && <Icon name="arrow" size={18} />}</button>
    </div>

    <details className="card audit"><summary>How your syllabus was checked <span className="meta">Original extraction</span></summary>
      <p className="muted">These are the original model results. Edits are checked locally in each section below.</p>
      <ProgressRow progress={{ section: 'grading', state: 'done', outcome: course.plan.grading }} sourceChars={course.plan.sourceChars} />
      <ProgressRow progress={{ section: 'schedule', state: 'done', outcome: course.plan.schedule }} sourceChars={course.plan.sourceChars} />
    </details>

    <div className="plan-grid">
      <section className="card grading-card" aria-labelledby="grading-title">
        <div className="section-heading"><div><h2 id="grading-title">Grading</h2></div><span className={`badge ${sumOff ? 'danger-text' : ''}`}>{Number(sum.toFixed(2))}% total</span></div>
        {course.components.length > 0 ? <>
          <div className="weight-bar" role="img" aria-label={course.components.map((c) => `${c.name}: ${c.weight}%`).join(', ')}>
            {course.components.map((c, i) => <div className={`weight-segment tone-${i % 5}`} key={i} style={{ flexGrow: Math.max(c.weight, 0) }} title={`${c.name}: ${c.weight}%`} />)}
          </div>
          <p className="meta edit-hint">Select a name, kind or weight to edit it.</p>
          <table className="grading-table"><caption className="sr-only">Editable grading components</caption><thead><tr><th scope="col">Component</th><th scope="col">Kind</th><th scope="col">Weight %</th></tr></thead><tbody>
            {course.components.map((c, i) => <tr key={i}>
              <td><div className="component-name"><span className={`legend-dot tone-${i % 5}`} /><input aria-label={`Component ${i + 1} name`} value={c.name} onChange={(e) => editComponent(i, { name: e.target.value })} /></div></td>
              <td><select aria-label={`Kind for component ${i + 1}`} value={c.kind} onChange={(e) => editComponent(i, { kind: e.target.value as GradingComponent['kind'] })}>{COMPONENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
              <td><input className="weight-input" aria-label={`Weight for component ${i + 1}`} type="number" min="0" max="100" step="any" value={c.weight} onChange={(e) => editComponent(i, { weight: Number(e.target.value) })} /></td>
            </tr>)}
          </tbody></table>
        </> : <div className="empty-state"><h3>No grading breakdown yet.</h3><p>Add the components from your syllabus below, or try extracting again.</p></div>}
        <button className="text-button add-button" onClick={() => onChange({ ...course, components: [...course.components, { name: 'New component', kind: 'other', weight: 0 }] })}>+ Add component</button>
        {(sumOff || !gradingReport.ok) && <div className="warning" role="status"><strong>{sumOff ? `Weights add up to ${Number(sum.toFixed(2))}%, not 100%.` : 'Check your edits against the syllabus.'}</strong>
          <ul>{gradingReport.issues.filter((issue) => issue.code !== 'sum').map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
        </div>}
      </section>

      <section className="card calculator-card" aria-labelledby="calculator-title">
        <h2 id="calculator-title">What do I need on the final?</h2>
        <p className="muted">Enter finished scores. Leave the rest blank to see the average you need on the remaining work.</p>
        <div className="score-inputs">{course.components.map((c, i) => <label key={i} className="score-row"><span>{c.name || `Component ${i + 1}`}<small>{c.weight}% of your grade</small></span>
          <span className="score-field"><input aria-label={`Score for ${c.name || `component ${i + 1}`}`} type="number" min="0" max="100" step="any" placeholder="—" value={scores[i] ?? ''} onChange={(e) => setScores((old) => { const next = [...old]; next[i] = e.target.value; return next; })} /><span>%</span></span>
        </label>)}</div>
        <label className="target-row" htmlFor="target-grade">I’m aiming for <select id="target-grade" value={target} onChange={(e) => setTarget(e.target.value)}>{Object.keys(thresholds).map((letter) => <option key={letter} value={letter}>{letter} ({thresholds[letter]}%)</option>)}</select></label>
        <div className="calculation" aria-live="polite">
          {calculation.status === 'invalid' ? <p>{!thresholdsValid ? 'Set thresholds from highest to lowest, between 0 and 100.' : calculation.message}</p>
            : calculation.status === 'already-secured' ? <><strong>Already secured ✓</strong><p>You’ve earned enough points for {target}, even with zero on the remaining work.</p></>
            : calculation.status === 'not-reachable' ? <><strong>Not reachable</strong><p>{calculation.remainingWeight ? `Even 100% on the remaining work would fall short of ${target}. Try another target.` : `All work is scored. Your total is ${Number(calculation.earned.toFixed(2))}%.`}</p></>
            : <><span className="needed-score">{Math.ceil(calculation.required * 10 - 1e-8) / 10}<small>%</small></span><p>{course.components.filter((_, i) => !scores[i]?.trim()).length === 1 ? 'needed on the remaining component' : 'weighted average needed on remaining work'} for {target}.</p></>}
        </div>
        <details className="thresholds"><summary>Edit letter-grade thresholds</summary><p className="meta">Use the cutoffs in your syllabus. No rounding or extra credit is assumed.</p><div className="threshold-grid">{Object.entries(thresholds).map(([letter, value]) => <label key={letter}>{letter}<input type="number" min="0" max="100" step="any" value={value} onChange={(e) => setThresholds({ ...thresholds, [letter]: e.target.value })} /></label>)}</div></details>
        <p className="privacy-note">Grades never leave the device. This calculator runs entirely in your browser.</p>
      </section>

      <section className="card dates-card" aria-labelledby="dates-title">
        <div className="section-heading"><div><h2 id="dates-title">Dates</h2></div>
          <button className="secondary" disabled={!course.dates.length || !course.dates.every(exportable)} onClick={() => exportDates(course.dates)}><Icon name="calendar" size={18} />Add to calendar</button></div>
        <p className="meta">Edit any field below. Calendar downloads contain all-day events.</p>
        {calendarError && <p className="warning" role="alert">{calendarError}</p>}
        {course.dates.length === 0 ? <div className="empty-state"><Icon name="calendar" size={32} /><h3>No dated items found.</h3><p>Your syllabus may use a separate schedule. Add a date below.</p></div>
          : <ol className="dates-list">{[...course.dates].sort((a, b) => a.date.localeCompare(b.date)).map((item) => <li key={item.id}>
            <div className="date-stamp" aria-hidden="true">{isRealDate(item.date) ? <><span>{new Date(`${item.date}T00:00:00Z`).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })}</span><strong>{Number(item.date.slice(-2))}</strong></> : <strong>—</strong>}</div>
            <div className="date-content"><input className="date-label" aria-label={`Event name for ${item.label || 'untitled event'}`} value={item.label} onChange={(e) => editDate(item.id, { label: e.target.value })} />
              <div className="date-controls"><input aria-label={`Date for ${item.label || 'untitled event'}`} type="date" value={item.date} onChange={(e) => editDate(item.id, { date: e.target.value })} />
                <select className="badge kind-select" aria-label={`Kind for ${item.label || 'untitled event'}`} value={item.kind} onChange={(e) => editDate(item.id, { kind: e.target.value as DatedItem['kind'] })}>{DATE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
              {exportable(item) && <div className="calendar-links"><button className="text-button" onClick={() => exportDates([item])}>Add to calendar</button><a href={googleCalendarUrl(course.title, item)} target="_blank" rel="noreferrer">Google Calendar <span aria-hidden="true">↗</span></a></div>}
            </div>
            <button className="icon-button delete-button" aria-label={`Delete ${item.label || 'untitled event'}`} onClick={() => onChange({ ...course, dates: course.dates.filter((d) => d.id !== item.id) })}><Icon name="trash" size={18} /></button>
          </li>)}</ol>}
        <button className="text-button add-button" onClick={() => onChange({ ...course, dates: [...course.dates, { id: crypto.randomUUID(), label: 'New date', date: course.term?.start ?? '', kind: 'deadline' }] })}>+ Add a date</button>
        {!scheduleReport.ok && <details className="warning"><summary>Review {scheduleReport.issues.length} date check{scheduleReport.issues.length === 1 ? '' : 's'}</summary><ul>{scheduleReport.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></details>}
      </section>
    </div>
  </div>;
}
