# Syllabus → Term

**Your syllabus, checked on your device.** Drop in a course syllabus and get its grading weights and every exam and deadline as a plan you can trust. The AI on your device reads it, deterministic checks verify every number against the page, and only a section that fails a check is sent to Gemini in the cloud.

- **Try it (no login):** https://buildhybridai-term.web.app
- **Platforms:** Web (Chrome, Gemini Nano) and iOS (Apple Foundation Models), both through Firebase AI Logic
- **Video:** _link added on submission_

On 43 real, publicly posted university syllabi, **87%** of grading tables came out exactly right with **3.8%** of the syllabus text leaving the device. Sending everything to the cloud: 85% exact, 23% of the text sent. (Mean of two full runs; method below.)

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
- **Repair before escalation.** A date that is not written anywhere in the syllabus cannot be fixed by a bigger model reading the same text, so it is dropped on device instead of paying for a cloud call.

## Firebase in this project

| Product | Use |
|---|---|
| **Firebase AI Logic** (web) | `getGenerativeModel` in `PREFER_ON_DEVICE` mode with a JSON-schema `responseConstraint` for Gemini Nano, and an `ONLY_IN_CLOUD` model (`gemini-3.8-flash`, low thinking, 30 s timeout) for escalation. `response.inferenceSource` labels every answer. [`web/src/firebase.ts`](web/src/firebase.ts) |
| **Firebase AI Logic** (iOS) | Apple `SystemLanguageModel` on device and `FirebaseAI.geminiLanguageModel(name:)` in the cloud, both driven through `LanguageModelSession` with the same `@Generable` schema. [`ios/SyllabusTerm/Models.swift`](ios/SyllabusTerm/Models.swift) |
| **App Check** | reCAPTCHA Enterprise on the web (started on the first AI call, not on page load), App Attest on iOS, debug provider in development and the simulator. |
| **Remote Config** | `escalation_enabled` (kill switch: failing sections stay on device and show their issues), `cloud_timeout_ms`, `stats_min_runs`. [`remoteconfig.template.json`](remoteconfig.template.json) |
| **Anonymous Auth + Firestore** | One text-free record per check (characters total and sent, where each section was answered, check results, escalations, time). Powers the live counter on the homepage. Rules allow create-only records with an exact key set, the caller's own uid and server time. [`firestore.rules`](firestore.rules) |
| **Hosting** | The judge link, deployed by [`scripts/deploy.py`](scripts/deploy.py) with a self-check and automatic rollback. |

No syllabus text, course names or grades are stored anywhere. Saved courses stay in the browser's local storage.

## What a student gets

- Grading table with weights that are known to add up, editable.
- Every exam and deadline, with an `.ics` export and Google Calendar links (web) or **Add dates to Calendar** (iOS).
- "What do I need on the final?" from the grades you enter, computed in the browser.
- A term timeline across all saved courses, with the next three dates highlighted.

## Evaluation

`eval/labels.jsonl` holds hand-made labels (grading components and graded dates) for 43 syllabi posted publicly by universities; `eval/SOURCES.md` lists each source URL. The syllabus texts are not redistributed: `uv run scripts/fetch_cases.py --check` rebuilds them from the source pages and checks each against the SHA-256 of the copy we labelled (43 of 43 matched on 2026-11-24; see [`eval/README.md`](eval/README.md)). `web/eval.html` runs the full router on every case in three modes (hybrid, device only, cloud only) in Chrome with Gemini Nano, and writes the results to `eval/results/`. Runs and conclusions are logged in [`EXPERIMENTS.md`](EXPERIMENTS.md).

| Mode | Grading exact | Text sent to cloud |
|---|---|---|
| Hybrid, verify-then-escalate (v5, v6 mean) | 0.87 | 3.8% |
| Device only | 0.69 | 0% |
| Cloud only | 0.85 | 22.9% |

When the grading checks pass, the on-device answer is exact 27 of 30 times; when they fail it is exact 0 of 9 times. That is why the checks are a good trigger for escalation.

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
