import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { checkGrading, checkSchedule, evidenceFor, isRealDate, SUM_TOLERANCE, type Term } from '../core/checks';
import { sliceSection } from '../core/router';
import type { DatedItem, GradingComponent } from '../core/schema';
import { calculateGrade, gradingTotal } from './grade';
import { downloadCalendar, googleCalendarUrl, type CalendarItem } from './ics';
import { COMPONENT_KINDS, DATE_KINDS, type Course, type GradingRow } from './storage';
import { Icon, ProgressRow, RemovedDates, ReportFeedback } from './ui';

export const formatDate = (date: string) => isRealDate(date)
  ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
  : 'Choose a date';

interface GradingRemoval {
  row: GradingRow;
  index: number;
  score: string | undefined;
  expiresAt: number;
}

export function removeGradingRow(course: Course, id: string, now = Date.now()): { next: Course; removal: GradingRemoval } | null {
  const index = course.components.findIndex(c => c.id === id);
  if (index < 0) return null;
  const scores = { ...course.scores };
  delete scores[id];
  return {
    next: { ...course, components: course.components.filter(c => c.id !== id), scores },
    removal: { row: course.components[index], index, score: course.scores[id], expiresAt: now + 8000 },
  };
}

export function undoGradingRemoval(course: Course, removal: GradingRemoval, now = Date.now()): Course {
  if (now >= removal.expiresAt || course.components.some(c => c.id === removal.row.id)) return course;
  const components = [...course.components];
  components.splice(removal.index, 0, removal.row);
  const scores = removal.score === undefined ? course.scores : { ...course.scores, [removal.row.id]: removal.score };
  return { ...course, components, scores };
}

function SourceEvidence({ item, section, term }: { item: GradingComponent | DatedItem; section: string; term?: Term }) {
  const [open, setOpen] = useState(false);
  return <details className="source-evidence" onToggle={e => setOpen(e.currentTarget.open)}><summary>Source</summary>
    {open && <p>{evidenceFor(item, section, term) ?? 'Not found in the text'}</p>}</details>;
}

export function CoursePlan({ course, onChange, onSave, saved }: {
  course: Course; onChange: (course: Course) => void; onSave: () => void; saved: boolean;
}) {
  const { scores, target, thresholds } = course;
  const [removal, setRemoval] = useState<GradingRemoval | null>(null);
  const cutoffEditor = useRef<HTMLDetailsElement>(null);
  const [calendarError, setCalendarError] = useState('');
  const gradingText = useMemo(() => sliceSection(course.sourceText, 'grading'), [course.sourceText]);
  const scheduleText = useMemo(() => sliceSection(course.sourceText, 'schedule'), [course.sourceText]);
  const totalPoints = course.plan.grading.value?.totalPoints;
  const gradingReport = useMemo(() => checkGrading({ totalPoints, components: course.components.map(c => ({ ...c })) }, gradingText), [course.components, gradingText, totalPoints]);
  const scheduleReport = useMemo(() => checkSchedule({ items: course.dates }, scheduleText, course.term, course.sourceText), [course.dates, scheduleText, course.term, course.sourceText]);
  const ordinary = course.components.filter(c => !c.bonus);
  const bonus = course.components.filter(c => c.bonus);
  const sum = gradingTotal(course.components);
  const sumOff = Math.abs(sum - 100) > SUM_TOLERANCE;
  const values = Object.values(thresholds).map((v) => v.trim() ? Number(v) : NaN);
  const thresholdsValid = values.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 100 && (i === 0 || v <= values[i - 1]));
  const scoreOf = (c: GradingRow) => scores[c.id]?.trim() ? Number(scores[c.id]) : null;
  const calculation = calculateGrade(course.components, course.components.map(scoreOf),
    thresholdsValid ? Number(thresholds[target]) : NaN);
  const bonusEntries = bonus.map(c => ({ max: c.weight, points: scoreOf(c) })).filter(entry => entry.points !== null);
  const bonusValid = bonusEntries.every(({ max, points }) => points !== null && Number.isFinite(points) && points >= 0 && points <= max);
  const bonusPoints = bonusEntries.reduce((total, { points }) => total + (points ?? 0), 0);
  useEffect(() => {
    if (!removal) return;
    const timeout = setTimeout(() => setRemoval(null), Math.max(0, removal.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [removal]);

  const editComponent = (id: string, patch: Partial<GradingComponent>) => {
    onChange({ ...course, components: course.components.map(c => c.id === id ? { ...c, ...patch } : c) });
  };
  const removeComponent = (id: string) => {
    const result = removeGradingRow(course, id);
    if (!result) return;
    setRemoval(result.removal);
    onChange(result.next);
  };
  const editDate = (id: string, patch: Partial<DatedItem>) => {
    onChange({ ...course, dates: course.dates.map((d) => d.id === id ? { ...d, ...patch } : d) });
  };
  const exportable = (item: CalendarItem) => isRealDate(item.date) && item.date !== '9999-12-31' && !!item.label.trim();
  const exportDates = (items: CalendarItem[]) => {
    try { downloadCalendar(course.id, course.title, items); setCalendarError(''); }
    catch (error) { setCalendarError(error instanceof Error ? error.message : 'Calendar export failed. Try again.'); }
  };
  const gradingTable = (rows: GradingRow[], caption: string) => <table className="grading-table">
    <caption className="sr-only">{caption}</caption><thead><tr><th scope="col">Component</th><th scope="col">Kind</th><th scope="col">Weight %</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead><tbody>
    {rows.map((c, i) => {
      const name = c.name || 'untitled component';
      return <Fragment key={c.id}><tr>
        <td><div className="component-name">{!c.bonus && <span className={`legend-dot tone-${i % 5}`} />}<input aria-label={`Name for ${name}`} value={c.name} onChange={e => editComponent(c.id, { name: e.target.value })} /></div>{c.points !== undefined && totalPoints !== undefined && <small>Converted from points ({c.points} of {totalPoints})</small>}</td>
        <td><select aria-label={`Kind for ${name}`} value={c.kind} onChange={e => editComponent(c.id, { kind: e.target.value as GradingComponent['kind'] })}>{COMPONENT_KINDS.map(k => <option key={k}>{k}</option>)}</select></td>
        <td><input className="weight-input" aria-label={`Weight for ${name}`} type="number" min="0" max="100" step="any" value={c.weight} onChange={e => editComponent(c.id, { weight: Number(e.target.value), points: undefined })} /></td>
        <td><button className="icon-button remove-component" aria-label={`Remove ${name}`} onClick={() => removeComponent(c.id)}><Icon name="trash" size={18} /></button></td>
      </tr><tr className="grading-source-row"><td colSpan={4}><SourceEvidence item={c} section={gradingText} /></td></tr></Fragment>;
    })}</tbody></table>;
  const scoreInput = (c: GradingRow) => <label key={c.id} className="score-row"><span>{c.name || 'Untitled component'}<small>{c.bonus ? `Up to ${c.weight} points` : `${c.weight}% of your grade`}</small></span>
    <span className="score-field"><input aria-label={`${c.bonus ? 'Extra credit points' : 'Score'} for ${c.name || 'untitled component'}`} type="number" min="0" max={c.bonus ? c.weight : 100} step="any" placeholder="—" value={scores[c.id] ?? ''} onChange={e => onChange({ ...course, scores: { ...scores, [c.id]: e.target.value } })} /><span>{c.bonus ? 'pts' : '%'}</span></span>
  </label>;
  return <div className="result-view">
    <div className="result-top">
      <div><label className="sr-only" htmlFor="course-title">Course title</label>
        <input id="course-title" className="course-title" value={course.title} onChange={(e) => onChange({ ...course, title: e.target.value })} />
        <p className="muted">{course.term ? `${formatDate(course.term.start)} — ${formatDate(course.term.end)}` : 'No term date filter'} · Review and edit your plan below.</p></div>
      <button className="primary" disabled={!course.title.trim() || saved} onClick={onSave}>{saved ? 'Saved' : 'Save to My courses'}{!saved && <Icon name="arrow" size={18} />}</button>
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
          {ordinary.length > 0 && <div className="weight-bar" role="img" aria-label={ordinary.map(c => `${c.name}: ${c.weight}%`).join(', ')}>
            {ordinary.map((c, i) => <div className={`weight-segment tone-${i % 5}`} key={c.id} style={{ flexGrow: Math.max(c.weight, 0) }} title={`${c.name}: ${c.weight}%`} />)}
          </div>}
          <p className="meta edit-hint">Select a name, kind or weight to edit it.</p>
          {ordinary.length > 0 && gradingTable(ordinary, 'Editable grading components')}
          {bonus.length > 0 && <div className="extra-credit"><h3>Extra credit (added on top of 100%)</h3>{gradingTable(bonus, 'Editable extra credit components')}</div>}
        </> : <div className="empty-state"><h3>No grading breakdown yet.</h3><p>Add the components from your syllabus below, or try extracting again.</p></div>}
        <button className="text-button add-button" onClick={() => onChange({ ...course, components: [...course.components, { id: crypto.randomUUID(), name: 'New component', kind: 'other', weight: 0 }] })}>+ Add component</button>
        {removal && <div className="undo-row" role="status"><span>Removed {removal.row.name || 'untitled component'}.</span><button className="link" onClick={() => {
          const restored = undoGradingRemoval(course, removal);
          if (restored !== course) onChange(restored);
          setRemoval(null);
        }}>Undo</button></div>}
        {(sumOff || !gradingReport.ok) && <div className="warning" role="status"><strong>{sumOff ? `Weights add up to ${Number(sum.toFixed(2))}%, not 100%.` : 'Check your edits against the syllabus.'}</strong>
          <ul>{gradingReport.issues.filter((issue) => issue.code !== 'sum').map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
        </div>}
      </section>

      <section className="card calculator-card" aria-labelledby="calculator-title">
        <h2 id="calculator-title">What do I need on the final?</h2>
        <p className="muted">Enter finished scores. Leave the rest blank to see the average you need on the remaining work.</p>
        <div className="score-inputs">{ordinary.map(scoreInput)}</div>
        <div className="target-row"><label htmlFor="target-grade">I’m aiming for <select id="target-grade" value={target} onChange={e => onChange({ ...course, target: e.target.value })}>{Object.keys(thresholds).map(letter => <option key={letter} value={letter}>{letter} ({thresholds[letter]}%)</option>)}</select></label>
          <a className="meta" href="#grade-thresholds" onClick={() => { if (cutoffEditor.current) cutoffEditor.current.open = true; }}>Default cut-offs (A = 93). Use your course's scale</a></div>
        <div className="calculation" aria-live="polite">
          {calculation.status === 'invalid' ? <p>{!thresholdsValid ? 'Set thresholds from highest to lowest, between 0 and 100.' : calculation.message}</p>
            : calculation.status === 'already-secured' ? <><strong>Already secured ✓</strong><p>You’ve earned enough points for {target}, even with zero on the remaining work.</p></>
            : calculation.status === 'not-reachable' ? <><strong>Not reachable</strong><p>{calculation.remainingWeight ? `Even 100% on the remaining work would fall short of ${target}. Try another target.` : `All work is scored. Your total is ${Number(calculation.earned.toFixed(2))}%.`}</p></>
            : <><span className="needed-score">{Math.ceil(calculation.required * 10 - 1e-8) / 10}<small>%</small></span><p>{ordinary.filter(c => scoreOf(c) === null).length === 1 ? 'needed on the remaining component' : 'weighted average needed on remaining work'} for {target}.</p></>}
        </div>
        {bonus.length > 0 && <div className="extra-credit"><h3>Extra credit (added on top of 100%)</h3>{bonus.map(scoreInput)}
          {bonusEntries.length > 0 && <p className="meta" role="status">{!bonusValid ? 'Enter extra credit points between zero and the listed maximum.'
            : calculation.status !== 'invalid' && calculation.remainingWeight === 0 ? `Grade with extra credit: ${Number((calculation.earned + bonusPoints).toFixed(2))}%.`
            : `${Number(bonusPoints.toFixed(2))} extra credit points to add to your final grade.`}</p>}</div>}
        <details className="thresholds" id="grade-thresholds" ref={cutoffEditor}><summary>Edit letter-grade thresholds</summary><p className="meta">Use the cut-offs in your syllabus. The required score uses the regular grading weights.</p><div className="threshold-grid">{Object.entries(thresholds).map(([letter, value]) => <label key={letter}>{letter}<input type="number" min="0" max="100" step="any" value={value} onChange={e => onChange({ ...course, thresholds: { ...thresholds, [letter]: e.target.value } })} /></label>)}</div></details>
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
              <SourceEvidence item={item} section={scheduleText} term={course.term} />
            </div>
            <button className="icon-button delete-button" aria-label={`Delete ${item.label || 'untitled event'}`} onClick={() => onChange({ ...course, dates: course.dates.filter((d) => d.id !== item.id) })}><Icon name="trash" size={18} /></button>
          </li>)}</ol>}
        <button className="text-button add-button" onClick={() => onChange({ ...course, dates: [...course.dates, { id: crypto.randomUUID(), label: 'New date', date: course.term?.start ?? '', kind: 'deadline' }] })}>+ Add a date</button>
        <ReportFeedback report={scheduleReport} />
        <RemovedDates removed={course.plan.schedule.removed} />
      </section>
    </div>
  </div>;
}
