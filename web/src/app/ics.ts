import { isRealDate } from '../core/checks';
import type { DatedItem } from '../core/schema';

export interface CalendarItem extends DatedItem { id: string }

const escapeText = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const compact = (iso: string) => iso.replace(/-/g, '');

function endDate(date: string): string {
  if (!isRealDate(date) || date === '9999-12-31') throw new Error('Choose a valid calendar date before exporting.');
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return compact(next.toISOString().slice(0, 10));
}

/** RFC 5545 content lines are folded at 75 UTF-8 octets, never inside a code point. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  let result = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
    result += char;
    bytes += size;
  }
  return result;
}

export function createCalendar(courseId: string, courseTitle: string, items: CalendarItem[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Syllabus Term//Course Plan//EN', 'CALSCALE:GREGORIAN'];
  for (const item of items) {
    const end = endDate(item.date);
    lines.push('BEGIN:VEVENT', `UID:${encodeURIComponent(courseId)}.${encodeURIComponent(item.id)}@syllabus-term.local`,
      `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(item.date)}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeText(`${courseTitle}: ${item.label}`)}`, `DESCRIPTION:${escapeText(`${item.kind} · ${courseTitle}`)}`, 'END:VEVENT');
  }
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(courseTitle: string, item: DatedItem): string {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `${courseTitle}: ${item.label}`,
    dates: `${compact(item.date)}/${endDate(item.date)}`, details: `${item.kind} · ${courseTitle}` });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function downloadCalendar(courseId: string, courseTitle: string, items: CalendarItem[]): void {
  const blob = new Blob([createCalendar(courseId, courseTitle, items)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${courseTitle.replace(/[^a-z0-9]+/gi, '-').slice(0, 60) || 'course'}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
