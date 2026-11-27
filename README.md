# Syllabus → Term

**Your syllabus, checked on your device.** A syllabus can run 15 pages, with the weights and dates that decide your grade buried among the policies. Drop in a course syllabus and get its grading weights and every exam and deadline as a plan you can trust. The AI on your device reads it, deterministic checks verify every number against the page, and only a section that fails a check is sent to Gemini in the cloud.

- **Try it (no login):** https://buildhybridai-term.web.app
- **Platforms:** Web (Chrome, Gemini Nano) and iOS (Apple Foundation Models), both through Firebase AI Logic
- **Code:** https://github.com/yy5652-hash/syllabus-term
- **Video (2:00):** https://youtu.be/hDIkXo_nOuA

On 43 real, publicly posted university syllabi, **82%** of grading tables matched exactly (every component name with its weight) with **5.9%** of the syllabus text sent to the cloud. Sending everything to the cloud: 78% exact, 23% of the text sent. On 12 further syllabus PDFs read through the app's own importer, hybrid sent 2.2% of the text (cloud only: 11%). Every table that passed its checks on the 43 was exact: 56 of 56. (Mean of two full runs; method below.)

## The idea: escalate on verification, not on availability

Most hybrid apps use the cloud when the local model is missing. Syllabus → Term asks a different question: *did the on-device answer pass its checks?*

```
syllabus ─► slice: grading lines │ dated lines
              │                     │
              ▼                     ▼
      on-device model         on-device model        Gemini Nano (Chrome) / Apple Foundation Models (iOS)
              │                     │
       checks: weights sum   checks: every date is
       to 100, each weight   written in the text and
       and name is in the    falls inside the term
       text                  (failed items are removed
              │               on device first)
        pass ─┴─ fail               │
         │        │                 │
       done   only this slice + the failed checks ─► Gemini in the cloud ─► checked again
```

- **Only the failing section leaves the device**, and only its relevant lines (about 90 of 252 characters on the sample), with the failed checks attached as hints.
- **The checks are the same code on every path.** A cloud answer that fails is shown with its issues; nothing is silently trusted.
- **Repair before escalation.** A date that is not written anywhere in the syllabus is dropped on device, and a group written as "Exams (50%): Midterm 20%, Final 30%" is split deterministically, instead of paying for a cloud call.
- **"Checked" means bound to the page.** Each weight must sit within a line of its component's name, each date within a line of its exam. What cannot be confirmed (no exam dates, a date outside the term) is marked *Needs your review*, never ticked.

## Firebase in this project

| Product | Use |
|---|---|
| **Firebase AI Logic** (web) | `getGenerativeModel` in `PREFER_ON_DEVICE` mode with a JSON-schema `responseConstraint` for Gemini Nano, and an `ONLY_IN_CLOUD` model (`gemini-3.8-flash`, low thinking, 30 s timeout) for escalation. `response.inferenceSource` labels every answer. [`web/src/firebase.ts`](web/src/firebase.ts) |
| **Firebase AI Logic** (iOS) | Apple `SystemLanguageModel` on device and `FirebaseAI.geminiLanguageModel(name:)` in the cloud, both driven through `LanguageModelSession` with the same `@Generable` schema. [`ios/SyllabusTerm/Models.swift`](ios/SyllabusTerm/Models.swift) |
| **App Check** | reCAPTCHA Enterprise on the web (started on the first AI call, not on page load), App Attest on iOS, debug provider in development and the simulator. |
| **Remote Config** | `escalation_enabled` (kill switch: failing sections stay on device and show their issues), `cloud_timeout_ms`, `stats_min_runs`. [`remoteconfig.template.json`](remoteconfig.template.json) |
| **Anonymous Auth + Firestore** | One text-free record per check (characters total and sent, where each section was answered, check results, escalations, time). Powers the live counter on the homepage. Rules allow create-only records with an exact key set, the caller's own uid and server time. [`firestore.rules`](firestore.rules) |
| **Hosting** | The judge link, deployed by [`scripts/deploy.py`](scripts/deploy.py) with a self-check and automatic rollback. |

Saved courses, including their syllabus text and your grades, stay in this browser's local storage. Run statistics contain no syllabus text, course names or grades.

## What a student gets

- Grading table with weights that are known to add up, editable.
- Every exam and deadline, with an `.ics` export and Google Calendar links (web) or **Add dates to Calendar** (iOS).
- "What do I need on the final?" from the grades you enter, computed in the browser.
- A term timeline across all saved courses, with the next three dates highlighted.

## Evaluation

`eval/labels.jsonl` holds hand-made labels (grading components and graded dates) for 43 syllabi posted publicly by universities; `eval/SOURCES.md` lists each source URL. The syllabus texts are not redistributed: `uv run scripts/fetch_cases.py --check` rebuilds them from the source pages and checks each against the SHA-256 of the copy we labelled (43 of 43 matched on 2026-11-24; see [`eval/README.md`](eval/README.md)). `web/eval.html` runs the full router on every case in three modes (hybrid, device only, cloud only) in Chrome with Gemini Nano, and writes the results to `eval/results/`. Runs and conclusions are logged in [`EXPERIMENTS.md`](EXPERIMENTS.md).

Scoring is strict: a grading table is exact only when every labelled component is matched by name **and** weight, with no extra rows; a date counts only when its date and its event both match. Every number is the mean of two full runs (v9, v10).

| Mode | Grading exact (43 syllabi) | Text sent to cloud | Grading exact (12 PDFs) | Text sent to cloud |
|---|---|---|---|---|
| Hybrid, verify-then-escalate | **0.82** | **5.9%** | 0.71 | **2.2%** |
| Device only | 0.71 | 0% | 0.50 | 0% |
| Cloud only | 0.78 | 23.3% | 0.75 | 11.0% |

On the 43, every grading table that passed its checks was exact (56 of 56 over the two runs), and the date pairs (event + date) were recalled at 0.92. That is why the checks are a good trigger for escalation: a ✓ means the answer can be relied on, and the sections without one are the ones sent to the cloud or marked for review. The 12 PDFs (eval/holdout/SOURCES.md, 11 universities) were added after the checks were written and run end to end through the PDF.js importer and term detection the app uses.

## Run it

Web (Node 24):

```bash
cd web && npm ci
cp .env.example .env   # Firebase web config, reCAPTCHA Enterprise site key, App Check debug token
npm run dev            # http://localhost:5173
npm test               # 31 tests: checks, router, kill switch, title guess, ics, grade maths
```

Gemini Nano needs desktop Chrome with the Prompt API; the page offers the model download. Without it every section is read in the cloud.

iOS (Xcode 27, iOS 27 simulator or device with Apple Intelligence):

```bash
cd ios/TermCore && swift test   # 9 tests, same cases as the web core
cd ios && xcodegen generate     # project from project.yml; add GoogleService-Info.plist and Secrets.xcconfig
```

Firebase setup is scripted: `python3 scripts/firebase_setup.py` publishes the Firestore rules, indexes and Remote Config template; `python3 scripts/deploy.py` builds and deploys the web app.

## Credits

- Colours from Katsushika Hokusai, *Under the Wave off Kanagawa* (1830/33), Art Institute of Chicago, CC0. The annotation ink is Prussian blue, the pigment that print made famous.
- Fonts: Literata and Atkinson Hyperlegible (SIL Open Font License), self-hosted through Fontsource.
- Built with Claude Code (Anthropic) and OpenAI Codex as coding assistants for code, tests and documentation. All AI at runtime is Firebase AI Logic: Gemini Nano, Apple Foundation Models and Gemini in the cloud.

## License

Apache License 2.0. See [LICENSE](LICENSE).
