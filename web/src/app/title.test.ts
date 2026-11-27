import { describe, expect, it } from 'vitest';
import { guessTitle } from './title';

describe('guessTitle', () => {
  it('prefers the line with a course code over a header line', () => {
    expect(guessTitle('Page 1\nSyllabus\nNew York University\nECON-UA 2 Principles of Macroeconomics\nGrading')).toBe('ECON-UA 2 Principles of Macroeconomics');
  });
  it('recognises MIT-style numbers', () => {
    expect(guessTitle('Massachusetts Institute of Technology\n6.006 Introduction to Algorithms')).toBe('6.006 Introduction to Algorithms');
  });
  it('skips location and time lines that look like course codes', () => {
    expect(guessTitle('Location LSRC B101\nCOMPSCI 210 Introduction to Computer Systems')).toBe('COMPSCI 210 Introduction to Computer Systems');
  });
  it('joins a bare code line with the course name on the next line', () => {
    expect(guessTitle('ECO 2023\nPrinciples of Microeconomics\nSection: B53')).toBe('ECO 2023 Principles of Microeconomics');
    expect(guessTitle('Economics 30020-02\nSpring 2026\nProfessor Eric Sims')).toBe('Economics 30020-02');
  });
  it('uses a labelled course line and ignores the season line', () => {
    expect(guessTitle('Fall 2025 Syllabus\nCourse: General Biology II\nInstructor: X')).toBe('General Biology II');
  });
  it('falls back to the first substantive line, then the file name', () => {
    expect(guessTitle('\n\nIntroduction to Poetry\nGrading')).toBe('Introduction to Poetry');
    expect(guessTitle('   \n12\n', 'hist_204-syllabus.pdf')).toBe('hist 204 syllabus');
  });
});
