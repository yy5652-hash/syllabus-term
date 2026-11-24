# Homepage redesign plan (frontend-design pass, 2026-11-22)

## What is wrong with the current page (template tells)
- Cream page + big serif display: the #1 generated-page default.
- Tracked ALL-CAPS eyebrow over every block ("LESS ADMIN. MORE POSSIBILITY.", "START WITH YOUR SYLLABUS").
- "01 / 02" numbering on content that is not a sequence; a decorative wave clip-art that says nothing about syllabi.
- The core action (drop a syllabus) is below the fold.

## Concept: the marked-up syllabus
The most characteristic thing in this product's world is a syllabus page with a TA's pen on it:
percentages circled, a margin tally that must reach 100, dates underlined and carried to a calendar.
That is literally what the app does (verify-then-escalate), so the hero *shows the check happening*.
Hokusai link: the pen ink is Prussian blue — the imported pigment that made *Under the Wave off Kanagawa* famous.
The wave clip-art goes; the term timeline below the hero becomes the horizon line.

## Tokens (palette A, hues unchanged)
| Name | Hex | Role |
|---|---|---|
| Paper | #f3ecdc | page |
| Sheet | #fffbf2 | the syllabus sheet only |
| Ink | #1b2a3e | text |
| Prussian pen | #2b4a7c | annotations, primary button, focus |
| Foam | #7f95ae | secondary marks, term line |
| Rust | #9e4427 | a failed check only (semantic, never decoration) |

Type: **Literata** (a book face built for long reading — the syllabus sheet and headings) + **Atkinson Hyperlegible** (UI, numbers; designed for legibility). Sentence case everywhere, no eyebrows, no monospace.

## Layout
```
Syllabus → Term                                   My courses   Theme
┌──────────────────────────────┐  ┌────────────────────────────────┐
│ Your syllabus, checked        │  │ ECON-UA 2 … Fall 2026          │ ← sheet, 1.5° tilt
│ on your device.               │  │ Problem sets   (25%)  ┐        │   pen circles each %
│ One line on how.              │  │ Midterm exam   (30%)  │ 25     │   margin tally
│                               │  │ Final exam     (30%)  │+30 … = │   "= 100 ✓"
│ [ Drop a syllabus PDF ]       │  │ Participation  (15%)  ┘  100 ✓ │
│ or paste text · Try the sample│  │ Midterm: Oct 15 ───────────────┼──┐ underline
│                               │  └────────────────────────────────┘  │
│ 3.8% of text to the cloud …   │                                      │
└──────────────────────────────┘                                       │
──Sep──────●Sep 17───────●Oct 15───●Oct 29──────●Dec 17──── term horizon (pins)
How it works: 1 Read on device → 2 Check every number → 3 Only failures go to the cloud
My courses (empty state invites a first syllabus)
```
Left-aligned text column; the sheet is the one bold element. Mobile: text + CTA first, sheet below, horizon scrolls.

## Principles
1. One memorable thing: the annotated sheet. Everything else is quiet: no cards, no shadows except the sheet.
2. One orchestrated load: pen marks draw in order (circle → tally → underline → pins), ~1.6 s, off under reduced motion.
3. Words say what happens: "Drop a syllabus PDF", "Try the sample", errors say what to fix.
4. Rust appears only when a check fails.

## Option B (for comparison)
Same structure on the cover's night sea (navy page, sheet glowing on it) so site and cover match.
