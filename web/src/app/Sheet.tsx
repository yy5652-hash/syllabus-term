import { formatDate } from './CoursePlan';

// Hand-drawn ellipse around a percentage; pathLength=1 lets CSS draw it in.
const circles = [
  'M6 15 C 4 4, 52 2, 56 13 C 58 25, 10 28, 5 17 C 3 12, 10 6, 18 5',
  'M5 14 C 5 3, 54 3, 56 14 C 57 26, 8 27, 6 16 C 5 10, 14 5, 22 5',
  'M4 15 C 3 4, 55 2, 57 14 C 58 26, 9 28, 5 16 C 4 11, 11 6, 20 5',
  'M6 15 C 5 3, 53 4, 55 14 C 56 25, 9 27, 6 16 C 5 11, 12 6, 19 6',
];
const grading: [string, string, number][] = [
  ['Problem sets', '25%', 25], ['Midterm exam', '30%', 30], ['Final exam', '30 percent', 30], ['Participation', '15%', 15],
];

/** The sample syllabus with a checker's pen on it: what the app does, shown rather than told. */
export function MarkedSheet() {
  return <figure className="sheet" aria-label="The sample syllabus being checked: the four grading weights 25, 30, 30 and 15 add up to 100, and the midterm and final dates are found in the text.">
    <div aria-hidden="true">
      <p className="sheet-title">ECON-UA 2 Principles of Macroeconomics</p>
      <p className="sheet-term">Fall 2026 · Tue/Thu 9:30</p>
      <p className="sheet-h">Grading</p>
      <div className="sheet-grading">
        <ul>
          {grading.map(([name, pct], i) => <li key={name}>{name}<span className="pct">{pct}
            <svg viewBox="0 0 60 30" preserveAspectRatio="none"><path pathLength={1} style={{ animationDelay: `${0.25 + i * 0.22}s` }} d={circles[i]} /></svg></span></li>)}
        </ul>
        <div className="tally">
          <svg className="bracket" viewBox="0 0 16 150" preserveAspectRatio="none"><path pathLength={1} d="M2 2 C 12 4, 10 40, 12 75 C 10 110, 12 146, 2 148" /></svg>
          <div className="tally-nums">{grading.map(([name, , n]) => <span key={name}>{n}</span>)}<b>100 ✓</b></div>
        </div>
      </div>
      <p className="sheet-h">Schedule</p>
      <ul className="sheet-dates">
        <li>Midterm exam: <span className="date">Thursday, October 15th<svg viewBox="0 0 200 10" preserveAspectRatio="none"><path pathLength={1} d="M2 6 C 60 2, 140 9, 198 4" /></svg></span></li>
        <li>Final exam <span className="date">December 17<svg viewBox="0 0 200 10" preserveAspectRatio="none"><path pathLength={1} d="M2 5 C 70 8, 130 2, 198 6" /></svg></span></li>
      </ul>
    </div>
  </figure>;
}

export interface HorizonPin { date: string; label: string }
const SAMPLE_PINS: HorizonPin[] = [
  { date: '2026-09-17', label: 'Problem set 1' }, { date: '2026-10-15', label: 'Midterm' },
  { date: '2026-10-29', label: 'Problem set 2' }, { date: '2026-12-17', label: 'Final' },
];

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 864e5;

/** The term as a horizon line: start to end, one pin per dated item. Sample pins until the user saves a course. */
export function Horizon({ pins, start, end }: { pins: HorizonPin[]; start?: string; end?: string }) {
  const own = pins.length > 0;
  const shown = (own ? pins : SAMPLE_PINS).slice().sort((a, b) => a.date.localeCompare(b.date));
  const from = own ? (start ?? shown[0].date) : '2026-09-01';
  const to = own ? (end ?? shown[shown.length - 1].date) : '2026-12-23';
  const span = Math.max(1, day(to) - day(from));
  let lastAbove = -Infinity; let lastBelow = -Infinity;
  const placed = shown.map((pin) => {
    const pos = Math.min(100, Math.max(0, ((day(pin.date) - day(from)) / span) * 100));
    // Alternate pins that would collide onto the other side of the line.
    const below = pos - lastAbove < 20 && pos - lastBelow >= 20;
    if (below) lastBelow = pos; else lastAbove = pos;
    return { ...pin, pos: own && shown.length === 1 ? 50 : pos, below };
  });
  return <section className="horizon-wrap" aria-labelledby="horizon-heading">
    <h2 id="horizon-heading" className="horizon-heading">{own ? 'Your term' : 'The sample term on your calendar'}</h2>
    <div className="horizon-scroll">
      <ol className={`horizon ${placed.some((p) => p.below) ? 'two-sided' : ''}`}>
        {placed.map((pin) => <li key={`${pin.date}-${pin.label}`} className={`pin ${pin.below ? 'below' : ''}`} style={{ left: `${pin.pos}%` }}>
          <i aria-hidden="true" /><time dateTime={pin.date}>{formatDate(pin.date)}</time><span>{pin.label}</span></li>)}
      </ol>
      <div className="horizon-ends" aria-hidden="true"><span>{formatDate(from)}</span><span>{formatDate(to)}</span></div>
    </div>
  </section>;
}
