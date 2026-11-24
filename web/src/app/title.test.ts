import { describe, expect, it } from 'vitest';
import { guessTitle } from './title';

describe('guessTitle', () => {
  it('prefers the line with a course code over a header line', () => {
    expect(guessTitle('Page 1\nSyllabus\nNew York University\nECON-UA 2 Principles of Macroeconomics\nGrading')).toBe('ECON-UA 2 Principles of Macroeconomics');
  });
  it('recognises MIT-style numbers', () => {
    expect(guessTitle('Massachusetts Institute of Technology\n6.006 Introduction to Algorithms')).toBe('6.006 Introduction to Algorithms');
  });
  it('falls back to the first substantive line, then the file name', () => {
    expect(guessTitle('\n\nIntroduction to Poetry\nGrading')).toBe('Introduction to Poetry');
    expect(guessTitle('   \n12\n', 'hist_204-syllabus.pdf')).toBe('hist 204 syllabus');
  });
});
