# Design

**Chosen 2026-11-22: Option A — Great Wave (Hokusai).** Other options kept for record; see design/palettes.png. All text pairs pass WCAG AA.

| Option | Painting | Source |
|---|---|---|
| A | Katsushika Hokusai, *Under the Wave off Kanagawa*, 1830/33 | Art Institute of Chicago 24645, CC0 — https://www.artic.edu/artworks/24645 |
| B | Vincent van Gogh, *The Bedroom*, 1889 | Art Institute of Chicago 28560, CC0 — https://www.artic.edu/artworks/28560 |
| C | Georges Seurat, *A Sunday on La Grande Jatte — 1884*, 1884–86 | Art Institute of Chicago 27992, CC0 — https://www.artic.edu/artworks/27992 |

Colours extracted with k-means (k=16) on the 200-px IIIF image in the browser; lightness adjusted for AA, hues kept.
Fonts: serif headings (Georgia-class) + system sans body. 8-px spacing grid.

## Cover (approved 2026-11-22)
Direction approved by the owner: dark navy sea with code-generated wave line art (palette A, no image of the painting), real UI screenshots (result page + "How your syllabus was checked"), two stat cards from the latest eval. Source `design/cover/cover.html`; render with Playwright headless at 1200×800 @2x → `cover.png` (2400×1600, 3:2). Update the numbers when the eval changes.
CoDesign version (2026-11-22, per global rule 0): design "Syllabus → Term — Devpost cover", revision ab3180a3461c (11-25: stats 82% / 5.9% = strict scorer, mean of eval v9+v10; was 7e0d4061ddf0), judge PASS (all 8 axes ≥ 8). Export `design/cover/cover-codesign.png` (1800×1200). Fonts Source Serif 4 + Inter; generated swells are parametric vector paths. Supersedes the hand-written `cover.html`.
