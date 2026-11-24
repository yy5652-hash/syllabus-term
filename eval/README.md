# Evaluation cases

`labels.jsonl` contains one human-labelled record per syllabus, with the case ID,
course and term metadata, grading weights, dated assessments or deadlines, and
annotation notes. `SOURCES.md` lists the original URLs and any stated licences.

The syllabus texts are omitted because many source pages give no redistribution
licence. Run the fetcher with `uv` from the repository root.

```sh
uv run scripts/fetch_cases.py
uv run scripts/fetch_cases.py --out /tmp/syllabus-cases --check
uv run scripts/fetch_cases.py --only ocw-14-01-f2023 --only nu-econ201-f2025
```

The default output is `eval/cases/<id>.txt`. Pages may have changed since
November 2026, so a few rebuilt texts may differ. `--check` compares each fetched
file with the labelled original's SHA-256 in `cases.sha256` and exits with a
nonzero status if any fetch fails or any hash differs.
