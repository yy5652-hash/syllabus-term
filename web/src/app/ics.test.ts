import { describe, expect, it } from 'vitest';
import { createCalendar, googleCalendarUrl, type CalendarItem } from './ics';

const event: CalendarItem = { id: 'exam-1', label: 'Final, part 1; bring notes\\pen\nRoom 2', date: '2028-02-29', kind: 'exam' };
const now = new Date('2026-11-22T12:30:00Z');
const unfold = (s: string) => s.replace(/\r\n /g, '');

describe('RFC 5545 calendar', () => {
  it('exports all-day events with exclusive next-day end, UTC stamp and CRLF', () => {
    const ics = createCalendar('course-1', 'Economics', [event], now);
    expect(ics).toContain('DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301');
    expect(ics).toContain('DTSTAMP:20261122T123000Z');
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2.0/);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('escapes punctuation, newlines and backslashes', () => {
    expect(unfold(createCalendar('course', 'Economics', [event], now)))
      .toContain('SUMMARY:Economics: Final\\, part 1\\; bring notes\\\\pen\\nRoom 2');
  });
  it('keeps UIDs stable after title, label and date edits and separates courses', () => {
    const uid = (course: string, title: string, item: CalendarItem) => unfold(createCalendar(course, title, [item], now)).match(/UID:(.+)\r\n/)![1];
    expect(uid('a', 'First', event)).toBe(uid('a', 'Renamed', { ...event, label: 'Renamed', date: '2027-01-01' }));
    expect(uid('a', 'First', event)).not.toBe(uid('b', 'First', event));
  });
  it('folds Unicode without splitting characters or exceeding 75 octets', () => {
    const ics = createCalendar('course', '統計学'.repeat(40), [event], now);
    expect(ics).toContain('\r\n ');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain('統計学'.repeat(40));
  });
  it('handles year rollover and rejects impossible dates', () => {
    expect(createCalendar('c', 'C', [{ ...event, date: '2026-12-31' }], now)).toContain('DTEND;VALUE=DATE:20270101');
    expect(() => createCalendar('c', 'C', [{ ...event, date: '2026-02-29' }], now)).toThrow();
  });
  it('builds an encoded Google Calendar URL with an exclusive end date', () => {
    const url = new URL(googleCalendarUrl('A & B', event));
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(`A & B: ${event.label}`);
    expect(url.searchParams.get('dates')).toBe('20280229/20280301');
  });
});
