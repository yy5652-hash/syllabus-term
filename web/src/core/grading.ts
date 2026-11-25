// The slice, checker and evidence UI use the same interpretation of grading rows.
// Keep the original lines for prompts and citations, including unitless PDF tables.
import { assessmentNoun, examConflict, nameWords, ordinals, ordinalsMatch, pluralSuffix, sharesWord } from './names';
import type { GradingComponent, GradingResult } from './schema';

const percent = /(?<![.\d])(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?|pct|additional (?:percentage )?points?\b)/gi;
const points = /(?<![.\d])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:points?|pts)\b/gi;
export const lineHasWeight = (line: string) => [...line.matchAll(percent)].length > 0;
export const weightGrounded = (weight: number, line: string) =>
  [...line.matchAll(percent)].some(m => Number(m[1]) === weight);

const tableHeader = /^\s*(?:type|item|category|component|assessment|assignment|activity)\s*[|\s]+(?:%|weight(?:\s*\(%\))?|percent(?:age)?)(?:[|\s]+(?:description|notes?|details?))?[|\s]*$/i;
const tableRow = /^\s*([a-z][a-z -]*?(?:\s+\d+)?)\s*[|\s]+(\d+(?:\.\d+)?)(?=[|\s]|$)(.*)$/i;
const parenthetical = /\((\d+(?:\.\d+)?)\)/g;
function tableWeights(lines: string[]): string[] {
  let inTable = false;
  return lines.map(line => {
    if (tableHeader.test(line)) { inTable = true; return line; }
    const row = inTable && tableRow.exec(line.trim());
    if (!row || Number(row[2]) > 100) { inTable = false; return line; }
    let detail = row[3];
    const parts = [...detail.matchAll(parenthetical)];
    if (parts.length >= 2 && equal(parts.reduce((sum, m) => sum + Number(m[1]), 0), Number(row[2]))) {
      detail = detail.replace(parenthetical, '$1%');
    }
    return row[1] + ' ' + row[2] + '%' + detail;
  });
}

const equal = (a: number, b: number) => Math.abs(a - b) < 1e-7;
const countWords = 'zero one two three four five six seven eight nine ten'.split(' ');
const countNoun = new RegExp('\\b(\\d+|' + countWords.slice(2).join('|') + ')\\s+(' + assessmentNoun + ')' + pluralSuffix + '?\\b', 'gi');
const bonus = /\b(?:extra[ -]credit|bonus|additional (?:percentage )?points?|added to your (?:final )?grade)\b/i;
const pluralHeading = new RegExp('\\b(' + assessmentNoun + ')' + pluralSuffix + '[\\s(:=—–-]*$', 'i');
const unnamed = /^[\s(,:=&-]*(?:and\b[\s,]*)?$/i;
const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

interface Entry { label: string; value: number; introducesParts: boolean; each: boolean }
type Part = { name: string; value: number };

function numberUnnamedParts(entries: Entry[]): Entry[] {
  const numbered = [...entries];
  for (const [i, entry] of entries.entries()) {
    const heading = pluralHeading.exec(entry.label);
    if (!heading) continue;
    const start = entry.introducesParts ? i + 1 : i;
    let end = i + 1;
    while (end < entries.length && unnamed.test(entries[end].label)) end++;
    if (end - start < 2) continue;
    const parts = entries.slice(start, end);
    if (entry.introducesParts && !equal(parts.reduce((sum, part) => sum + part.value, 0), entry.value)) continue;
    const noun = capitalized(heading[1].toLowerCase());
    parts.forEach((part, j) => { numbered[start + j] = { ...part, label: `${noun} ${j + 1}` }; });
  }
  return numbered;
}

export function gradingRows(text: string) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const annotated = tableWeights(lines);
  const pointMode = !annotated.some(lineHasWeight) && annotated.some(l => [...l.matchAll(points)].length);
  const unit = pointMode ? points : percent;
  const anchors = annotated.map(l => [...l.matchAll(unit)].length > 0);
  return { lines, annotated, pointMode, unit, anchors };
}

export function gradingEvidence(source: string) {
  const { lines, annotated, pointMode, unit, anchors } = gradingRows(source);
  return { pointMode, rows: annotated.flatMap((line, i) => {
    const matches = [...line.matchAll(unit)];
    if (!matches.length) return [];
    const indices = [i - 1, i, i + 1].filter(j => j >= 0 && j < lines.length && (j === i || !anchors[j]));
    const window = indices.map(j => lines[j]).join('\n');
    const row = indices.map(j => annotated[j]).join(' ');
    const preceding = indices.includes(i - 1) ? annotated[i - 1] + ' ' : '';
    let end = 0;
    const entries = matches.map((m, n) => {
      const label = matches.length === 1 ? row.replace(unit, ' ') : (n === 0 ? preceding : '') + line.slice(end, m.index);
      end = m.index + m[0].length;
      const next = matches[n + 1];
      const introducesParts = /^\s*\)?\s*[:=]/.test(line.slice(end)) ||
        (next !== undefined && /^\s*\([^)]*$/.test(line.slice(end, next.index))) ||
        (n === 0 && matches.length > 1 && line !== lines[i]);
      return { label, value: Number(m[1].replace(/,/g, '')), introducesParts, each: /^\s*each\b/i.test(line.slice(end)) ||
        (matches.length === 1 && /^\s*each\b/i.test(annotated[i + 1] ?? '')) };
    });
    const groups = entries.flatMap((entry, j) => {
      if (!entry.each || pointMode) return [];
      const label = nameWords(entry.label).length ? entry.label : entries[j - 1]?.label ?? entry.label;
      const counts = [...label.matchAll(countNoun)];
      const count = counts.length === 1 ? Number(counts[0][1]) || countWords.indexOf(counts[0][1].toLowerCase()) : 0;
      return [{ label, perItem: entry.value, count, noun: counts.length === 1 ? counts[0][2].toLowerCase() : '' }];
    });
    const nextBonus = /^\s*(?:extra[ -]credit|bonus)[:\s]*$/i.test(lines[i + 1] ?? '') && anchors[i + 2];
    return [{ index: i, row, window, entries: numberUnnamedParts(entries), groups,
      bonus: bonus.test(nextBonus ? preceding + line : row) }];
  }) };
}
type Row = ReturnType<typeof gradingEvidence>['rows'][number];

function namedParts(entries: Entry[]): Part[] {
  const parts = entries.map(({ label, value }) => {
    const name = label.replace(/^[^(]*\(\s*(?=[a-z])/i, '')
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
      .replace(/^(?:and\s+)?(?:(?:one|an?)\s+)?/i, '')
      .replace(/\s+(?:(?:is\s+)?worth|counts?\s+for|at|is)$/i, '');
    return { name: capitalized(name), value };
  });
  if (parts.some(p => !/^(?:\d+(?:st|nd|rd|th) +)?[a-z][a-z0-9]*(?:[ -]+[a-z0-9]+)*$/i.test(p.name) || !nameWords(p.name).length) ||
      new Set(parts.map(p => p.name.toLowerCase())).size !== parts.length) return [];
  return parts;
}

// A parent may introduce inline parts or be followed by numbered rows.
// Stop at the first unrelated row so another category cannot supply a subtotal.
function sourceGroup(name: string, amount: number, rows: Row[]): Part[] | undefined {
  const isMember = (label: string) => sharesWord(name, label) ||
    (nameWords(name).includes('exam') && nameWords(label).includes('final'));
  let found = false;
  for (const [i, row] of rows.entries()) {
    if (!sharesWord(name, row.row) || examConflict(name, row.row)) continue;
    const parent = row.entries.findIndex(e => e.value === amount && sharesWord(name, e.label) && ordinalsMatch(name, e.label));
    if (parent < 0 && ordinals(name).length) continue;
    for (const g of row.groups) {
      const ratio = amount / g.perItem;
      if (!sharesWord(name, g.label) || g.perItem <= 0 || ratio < 2 || !equal(Math.round(ratio) * g.perItem, amount)) continue;
      found = true;
      if (g.count < 2 || g.count > 1000 || !sharesWord(name, g.noun) || examConflict(name, g.label) ||
          !equal(g.count * g.perItem, amount) || ordinals(name).length) continue;
      const noun = capitalized(g.noun);
      return Array.from({ length: g.count }, (_, n) => ({ name: `${noun} ${n + 1}`, value: g.perItem }));
    }
    const members = row.entries.slice(parent + 1);
    const introduced = parent >= 0 && row.entries[parent].introducesParts;
    let sum = 0;
    const parts: Entry[] = [];
    for (let j = i; j < rows.length; j++) {
      if (j > i && rows[j].index !== rows[j - 1].index + 1) break;
      const entries = j === i ? members : rows[j].entries;
      let stop = false;
      for (const e of entries) {
        if (e.value <= 0 || e.value >= amount || (!introduced && !isMember(e.label))) { stop = true; break; }
        sum += e.value;
        parts.push(e);
        if (parts.length >= 2 && equal(sum, amount)) {
          const named = namedParts(parts);
          if (named.length) return named;
          found = true;
          break;
        }
      }
      if (stop || sum >= amount) break;
    }
  }
  return found ? [] : undefined;
}

// An empty array identifies a subtotal without enough information to repair it.
export function groupParts(c: GradingComponent, rows: Row[], pointMode: boolean): Part[] | undefined {
  const amount = pointMode ? c.points : c.weight;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return;
  const breakdown = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(c.name);
  const unit = pointMode ? points : percent;
  if (!breakdown || [...breakdown[2].matchAll(unit)].length < 2) return sourceGroup(c.name, amount, rows);
  const heading = breakdown[1];
  const fromSource = sourceGroup(heading, amount, rows);
  if (fromSource?.length) return fromSource;
  const ownRow = gradingEvidence(`${heading} ${amount}${pointMode ? ' points' : '%'}: ${breakdown[2]}`).rows[0];
  const entries = ownRow?.entries.slice(1) ?? [];
  if (entries.length >= 2 && entries.every(e => e.value > 0) && equal(entries.reduce((sum, e) => sum + e.value, 0), amount)) {
    const parts = namedParts(entries);
    if (parts.length) return parts;
  }
  return fromSource;
}

export function binds(c: GradingComponent, value: number, row: Row): boolean {
  const numbered = ordinals(c.name);
  if (numbered.length === 1 && row.groups.some(g => g.count >= 2 && g.perItem === value &&
      sharesWord(c.name, g.noun) && !examConflict(c.name, g.label) && numbered[0] <= g.count)) return true;
  return row.entries.some(e => e.value === value && sharesWord(c.name, e.label) &&
    ordinalsMatch(c.name, e.label) && !examConflict(c.name, e.label));
}

export function splitGroups(result: GradingResult | null, source: string) {
  let repairedItems = 0;
  if (!Array.isArray(result?.components)) return { value: result, repairedItems };
  const { rows, pointMode } = gradingEvidence(source);
  const components = result.components.flatMap(c => {
    if (!c || typeof c.name !== 'string') return [c];
    const parts = groupParts(c, rows, pointMode);
    if (!parts?.length) return [c];
    repairedItems++;
    return parts.map(({ name, value }) => pointMode ? { ...c, name, points: value } : { ...c, name, weight: value });
  });
  return { value: { ...result, components }, repairedItems };
}
