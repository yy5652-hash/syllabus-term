import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { isRealDate, type Term } from '../core/checks';
import { inferTerm } from '../core/dates';
import { APP_NAME } from './brand';
import { CoursePlan, formatDate } from './CoursePlan';
import { ModelStatus, useDeviceModel } from './ModelStatus';
import { extractWithProgress, type SectionProgress } from './pipeline';
import { readSyllabus } from './pdf';
import { SAMPLE } from './sample';
import { Horizon, MarkedSheet } from './Sheet';
import { guessTitle } from './title';
import type { LiveStats } from '../cloud';
import { defaultTerm, loadCourses, loadTheme, localToday, newCalculator, saveCourses, saveTheme, type Course, type Theme } from './storage';
import { Icon, Modal, ProgressRow } from './ui';

const initialProgress = (): SectionProgress[] => [
  { section: 'grading', state: 'waiting' }, { section: 'schedule', state: 'waiting' },
];

interface SyllabusInput {
  text: string;
  filename: string;
  term: Term;
  termOrigin: 'inferred' | 'default' | 'edited';
  showTermDates: boolean;
}
type InputAction = { type: 'load'; text: string; filename?: string; now?: Date }
  | { type: 'edit-term'; field: 'start' | 'end'; value: string }
  | { type: 'toggle-dates' };

export function updateSyllabusInput(input: SyllabusInput, action: InputAction): SyllabusInput {
  if (action.type === 'load') {
    const inferred = inferTerm(action.text);
    return { text: action.text, filename: action.filename ?? '', term: inferred ?? defaultTerm(action.now),
      termOrigin: inferred ? 'inferred' : 'default', showTermDates: !inferred };
  }
  if (action.type === 'edit-term') {
    return { ...input, term: { start: input.term.start, end: input.term.end, [action.field]: action.value }, termOrigin: 'edited' };
  }
  return { ...input, showTermDates: !input.showTermDates };
}

export function App() {
  const [screen, setScreen] = useState<'home' | 'processing' | 'result'>('home');
  const [input, updateInput] = useReducer(updateSyllabusInput, undefined, (): SyllabusInput => ({
    text: '', filename: '', term: defaultTerm(), termOrigin: 'default', showTermDates: true,
  }));
  const { text, filename, term, termOrigin, showTermDates } = input;
  const [error, setError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(initialProgress);
  const [loaded] = useState(loadCourses);
  const [courses, setCourses] = useState(loaded.courses);
  const [storageError, setStorageError] = useState(loaded.error);
  const [current, setCurrent] = useState<Course | null>(null);
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [showHow, setShowHow] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [live, setLive] = useState<LiveStats | null>(null);
  const main = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const model = useDeviceModel();
  const cloudOnly = model.availability !== 'available' && model.availability !== 'checking';

  useEffect(() => {
    document.title = APP_NAME;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);
  useEffect(() => { main.current?.focus(); window.scrollTo({ top: 0 }); }, [screen]);
  // The live counter loads after the page is idle, so Firestore never delays the first paint.
  useEffect(() => {
    if (screen !== 'home') return;
    const id = setTimeout(() => { void import('../cloud').then((c) => c.liveStats()).then(setLive).catch(() => {}); }, 1500);
    return () => clearTimeout(id);
  }, [screen]);

  const loadFile = async (file: File) => {
    if (readingFile) return;
    setReadingFile(true); setError('');
    try { updateInput({ type: 'load', text: await readSyllabus(file), filename: file.name }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open this file. Paste the text instead.'); }
    finally { setReadingFile(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || readingFile) return;
    if (!text.trim()) { setError('Add your syllabus as a PDF, a text file or pasted text first.'); return; }
    if (!isRealDate(term.start) || !isRealDate(term.end) || term.end < term.start) {
      setError('Choose a valid term start and end, with the end on or after the start.');
      if (!showTermDates) updateInput({ type: 'toggle-dates' });
      return;
    }
    setError(''); setBusy(true); setProgress(initialProgress()); setScreen('processing');
    try {
      const [{ hybrid, cloud, setCloudTimeout }, cloudModule] = await Promise.all([import('../firebase'), import('../cloud')]);
      const switches = await cloudModule.loadSwitches();
      setCloudTimeout(switches.cloudTimeoutMs);
      const started = performance.now();
      const plan = await extractWithProgress(text, Number(term.start.slice(0, 4)),
        { hybrid: cloudOnly ? cloud : hybrid, cloud }, term, (update) => setProgress((old) => old.map((row) => row.section === update.section ? update : row)), switches.escalationEnabled);
      if (plan.grading.finalSource !== 'unknown' && plan.schedule.finalSource !== 'unknown') void cloudModule.recordRun({ charsTotal: text.length, charsSent: Math.min(text.length, plan.grading.charsSentToCloud + plan.schedule.charsSentToCloud),
        gradingSource: plan.grading.finalSource, datesSource: plan.schedule.finalSource, gradingOk: plan.grading.finalReport.status === 'checked', datesOk: plan.schedule.finalReport.status === 'checked',
        escalated: Number(plan.grading.escalated) + Number(plan.schedule.escalated), repaired: plan.grading.repairedItems + plan.schedule.repairedItems,
        ms: Math.min(600_000, Math.round(performance.now() - started)), sample: text === SAMPLE });
      setCurrent({ id: crypto.randomUUID(), title: guessTitle(text, filename),
        sourceText: text, term, components: (plan.grading.value?.components ?? []).map((component) => ({ ...component, id: crypto.randomUUID() })),
        dates: (plan.schedule.value?.items ?? []).map((date) => ({ ...date, id: crypto.randomUUID() })), plan, ...newCalculator() });
      setSaved(false); setScreen('result');
    } catch {
      setError('We couldn’t finish reading your syllabus. Check your connection and AI setup, then try again. Your input is still here.');
    } finally { setBusy(false); }
  };

  const persist = (next: Course[]) => { setCourses(next); const issue = saveCourses(next); setStorageError(issue); return !issue; };
  const saveCurrent = () => {
    if (!current) return;
    const course = { ...current, title: current.title.trim() };
    setCurrent(course);
    setSaved(persist([...courses.filter((c) => c.id !== course.id), course]));
  };
  const timeline = courses.flatMap((course) => course.dates.filter((date) => isRealDate(date.date)).map((date) => ({ ...date, course })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.course.title.localeCompare(b.course.title));
  const nextIds = new Set(timeline.filter((item) => item.date >= localToday()).slice(0, 3).map((item) => `${item.course.id}:${item.id}`));

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <button className="brand" onClick={() => setScreen('home')} disabled={busy}>{APP_NAME}</button>
      <div className="header-actions"><ModelStatus model={model} /><button className="nav-button" disabled={busy} onClick={() => { setScreen('home'); setTimeout(() => document.getElementById('my-courses')?.scrollIntoView(), 0); }}>My courses{courses.length > 0 && <span className="course-count">{courses.length}</span>}</button>
        <label className="theme-control"><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} /><span className="sr-only">Colour theme</span><select aria-label="Colour theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      </div>
    </div></header>

    <main id="main" ref={main} tabIndex={-1} className="main-shell">
      {storageError && <div className="warning notice" role="alert">{storageError}</div>}
      {model.error && <div className="warning notice" role="status">{model.error}</div>}
      {screen === 'home' && <>
        <section className="hero" aria-labelledby="home-heading">
          <div className="hero-copy">
            <h1 id="home-heading">{cloudOnly ? 'Your syllabus, checked against the page.' : 'Your syllabus, checked on your device.'}</h1>
            <p className="lede">{cloudOnly ? "On this browser the AI on your device isn't available, so the grading and date sections (not the whole syllabus) are read by Gemini in the cloud." : 'The AI in your browser reads the grading weights and deadlines, then every number is checked against the page. Only a section that fails a check is sent to the cloud.'}</p>
            <form className="start" onSubmit={(e) => void run(e)}>
              <div className={`drop ${dragging ? 'dragging' : ''}`} aria-busy={readingFile}
                onDragOver={(e) => { e.preventDefault(); if (!readingFile) setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); if (!readingFile && e.dataTransfer.files[0]) void loadFile(e.dataTransfer.files[0]); }}>
                <input ref={fileInput} type="file" accept=".pdf,.txt,application/pdf,text/plain" id="syllabus-file" className="sr-only" tabIndex={-1} aria-label="Choose a syllabus PDF or text file" disabled={readingFile} onChange={(e) => { if (e.target.files?.[0]) void loadFile(e.target.files[0]); }} />
                <button type="button" className="primary" disabled={readingFile} onClick={() => fileInput.current?.click()}>{readingFile ? <><span className="spinner" />Reading your file…</> : <><Icon name="upload" size={20} />{text ? 'Choose another PDF' : 'Choose a syllabus PDF'}</>}</button>
                <p className="drop-alt">or drop it here · <button type="button" className="link" aria-expanded={showPaste} aria-controls="syllabus-text" onClick={() => setShowPaste(!showPaste)}>paste text</button> · <button type="button" className="link" disabled={readingFile} onClick={() => { updateInput({ type: 'load', text: SAMPLE }); setError(''); setShowPaste(false); }}>try the sample</button></p>
              </div>
              {showPaste && <div className="paste"><label htmlFor="syllabus-text">Syllabus text</label>
                <textarea id="syllabus-text" rows={7} value={text} disabled={readingFile} placeholder="Paste your course syllabus here" aria-describedby={error ? 'input-error' : undefined} onChange={(e) => { updateInput({ type: 'load', text: e.target.value }); setError(''); }} /></div>}
              {text.trim() && <div className="ready">
                <p className="ready-line"><Icon name="book" size={20} /><span><strong>{guessTitle(text, filename)}</strong><span className="meta">{filename ? `${filename} · ` : ''}{text.length.toLocaleString()} characters, still only in this tab</span></span></p>
                <div className="term-settings">
                  <div className="term-summary"><span>Term: {termOrigin === 'inferred' ? `${term.label} (found in the syllabus)` : termOrigin === 'default' ? 'not found — set the term dates' : `${formatDate(term.start)} to ${formatDate(term.end)}`}</span>
                    {(termOrigin !== 'default' || !showTermDates) && <button type="button" className="link" aria-expanded={showTermDates} aria-controls="term-fields" onClick={() => updateInput({ type: 'toggle-dates' })}>Change</button>}</div>
                  <div className="term-fields" id="term-fields" hidden={!showTermDates}><label htmlFor="term-start">Starts<input type="date" id="term-start" value={term.start} onChange={(e) => updateInput({ type: 'edit-term', field: 'start', value: e.target.value })} /></label><label htmlFor="term-end">Ends<input type="date" id="term-end" value={term.end} onChange={(e) => updateInput({ type: 'edit-term', field: 'end', value: e.target.value })} /></label></div>
                </div>
                <button className="primary" type="submit" disabled={readingFile}>Check my syllabus</button>
              </div>}
              {error && <p id="input-error" className="warning" role="alert">{error}</p>}
              {model.availability === 'downloadable' && <p className="meta cloud-notice">You can enable on-device AI at the top of the page.</p>}
            </form>
            <p className="proof">On 43 real syllabi, <b>82%</b> of grading tables matched exactly, every name with its weight, with <b>6%</b> of the text sent to the cloud. Sending everything to the cloud: 78% and 23%.{live && <> Live on this site: <b>{live.runs.toLocaleString()}</b> syllabi checked so far, <b>{Math.round(live.keptShare * 1000) / 10}%</b> of syllabus text kept on the device.</>}</p>
          </div>
          <MarkedSheet />
        </section>

        <Horizon pins={timeline.map((item) => ({ date: item.date, label: courses.length > 1 ? `${item.label} · ${item.course.title.split(' ').slice(0, 2).join(' ')}` : item.label }))} start={courses.find((c) => c.term)?.term?.start} end={courses.find((c) => c.term)?.term?.end} />

        <section className="how" aria-labelledby="how-heading" id="how-it-works">
          <h2 id="how-heading" className="sr-only">How it works</h2>
          <ol>
            {cloudOnly ? <li><h3>Read the relevant sections</h3><p>Gemini reads the grading and date excerpts in the cloud.</p></li> : <li><h3>Read on your device</h3><p>Chrome’s built-in Gemini Nano reads the grading and date excerpts.</p></li>}
            <li><h3>Check every number</h3><p>Grading weights and dates are checked against the text. Dates outside the term are flagged for review.</p></li>
            {cloudOnly ? <li><h3>Review the suggested plan</h3><p>Check flagged items and make any corrections before saving.</p></li> : <li><h3>Ask the cloud only when a check fails</h3><p>That one section goes to Gemini in the cloud with the failed checks attached. The answer is checked again.</p></li>}
          </ol>
        </section>

        <section id="my-courses" className="my-courses" aria-labelledby="courses-heading">
          <div className="row-spread"><h2 id="courses-heading">My courses</h2><span className="meta">Saved in this browser only</span></div>
          {!courses.length ? <p className="courses-empty">Check a syllabus above and save it. Its grading and dates will live here, and its deadlines will join the term line.</p>
            : <ul className="course-list">{courses.map((course) => <li key={course.id}>
              <button className="course-open" onClick={() => { setCurrent(structuredClone(course)); setSaved(!storageError); setScreen('result'); }}><strong>{course.title}</strong><span className="meta">{course.components.length} grading parts, {course.dates.length} dates{course.term ? `, ${course.term.start.slice(0, 4)}` : ''}</span></button>
              <button className="icon-button delete-button" aria-label={`Delete ${course.title}`} onClick={() => { persist(courses.filter((c) => c.id !== course.id)); if (current?.id === course.id) setSaved(false); }}><Icon name="trash" size={18} /></button></li>)}</ul>}
          {timeline.length > 0 && <ol className="term-timeline" aria-label="All saved dates">{timeline.map((item) => <li key={`${item.course.id}:${item.id}`} className={nextIds.has(`${item.course.id}:${item.id}`) ? 'up-next' : ''}><time dateTime={item.date}>{formatDate(item.date)}</time><div><strong>{item.label}</strong><button className="text-button timeline-course" onClick={() => { setCurrent(structuredClone(item.course)); setSaved(!storageError); setScreen('result'); }}>{item.course.title}</button></div>{nextIds.has(`${item.course.id}:${item.id}`) && <span className="next-label">Up next</span>}</li>)}</ol>}
        </section>
      </>}
      {screen === 'processing' && <section className="processing-view" aria-labelledby="processing-title"><h1 id="processing-title">Checking your syllabus</h1><p className="lede">{cloudOnly ? 'The grading and date excerpts are read in the cloud and checked against the page.' : 'Each section is read, then checked against the page. A section that fails goes to the cloud once.'}</p><div className="card processing-card" aria-live="polite" aria-busy={busy}>{progress.map((row) => <ProgressRow key={row.section} progress={row} sourceChars={text.length} cloudOnly={cloudOnly} />)}</div><p className="meta">{text.length.toLocaleString()} syllabus characters · Course year {term.start.slice(0, 4)}</p>{error && <div className="warning" role="alert"><p>{error}</p><div className="input-actions"><button className="primary" onClick={() => void run()}>Try again</button><button className="secondary" onClick={() => setScreen('home')}>Back to syllabus</button></div></div>}</section>}

      {screen === 'result' && current && <><button className="text-button back-button" onClick={() => setScreen('home')}>← Back to my courses</button><CoursePlan key={current.id} course={current} saved={saved} onChange={(course) => { setCurrent(course); setSaved(false); }} onSave={saveCurrent} /></>}
    </main>
    <footer className="site-footer"><div><span className="footer-brand">{APP_NAME}</span><p>Colours from Katsushika Hokusai, Under the Wave off Kanagawa (1830/33), Art Institute of Chicago, CC0.</p></div><a href="#how-it-works" onClick={(e) => { e.preventDefault(); setShowHow(true); }}>How it works <span aria-hidden="true">↗</span></a></footer>
    {showHow && <Modal onClose={() => setShowHow(false)}><ul className="how-list"><li><strong>Read on your device first.</strong> When Chrome’s on-device model is ready, the grading and date excerpts are read locally. If unavailable, those excerpts are read in the cloud.</li><li><strong>Check before trusting.</strong> Deterministic checks compare weights, component names and dates with your syllabus, verify the grading total and check dates against your term.</li><li><strong>Escalate only what fails.</strong> If a device answer fails, only that section is sent to the cloud with the failed check messages. The cloud answer is checked again; unresolved issues stay visible for your review.</li></ul></Modal>}
  </>;
}
