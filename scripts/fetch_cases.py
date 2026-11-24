#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["httpx==0.28.1", "pypdf==6.21.4"]
# ///
"""Rebuild the November 2026 evaluation inputs from their public sources."""

import argparse
import hashlib
import html
import io
import json
import logging
import re
import time
from html.parser import HTMLParser
from pathlib import Path

import httpx
from pypdf import PdfReader


EVAL_DIR = Path(__file__).resolve().parents[1] / "eval"
MAX_CHARS = 12_000
CASE_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]*")
BLOCK_TAGS = set("p div br li tr h1 h2 h3 h4 h5 h6 table ul ol section dd dt dl blockquote pre".split())
SKIP_TAGS = set("script style nav footer header noscript svg form button select".split())
TABLE_CELLS = {"td", "th"}
INLINE_IN_CELL = {"p", "div", "br", "li", "ul", "ol"}
OCW_MARKER = 'id="course-content-section"'
# The first OCW batch retained the first Course Info block in its excerpts.
OCW_WITH_COURSE_INFO = {
    "ocw-14-01-f2023", "ocw-14-13-s2020", "ocw-14-15j-s2018",
    "ocw-14-381-f2018", "ocw-15-071-s2017", "ocw-18-04-s2018",
    "ocw-18-404j-f2020", "ocw-18-600-f2019", "ocw-6-006-s2020",
}


class SyllabusHTML(HTMLParser):
    """Preserve source line breaks, list markers and table separators."""

    def __init__(self):
        super().__init__()
        self.parts = []
        self.cell_depth = 0
        self.hidden_depth = 0

    def block_break(self, tag):
        return tag in BLOCK_TAGS and not (self.cell_depth and tag in INLINE_IN_CELL)

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self.hidden_depth += 1
        if tag in TABLE_CELLS:
            self.cell_depth += 1
            self.parts.append(" | ")
        elif self.block_break(tag):
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("- ")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self.hidden_depth = max(0, self.hidden_depth - 1)
        if tag in TABLE_CELLS:
            self.cell_depth = max(0, self.cell_depth - 1)
        elif self.block_break(tag):
            self.parts.append("\n")
        elif self.cell_depth and tag in {"p", "div", "li"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden_depth:
            self.parts.append(re.sub(r"\s+", " ", data) if self.cell_depth else data)


def extract_html(body, case_id, course):
    markup = body.decode("utf-8", errors="replace")
    ocw = case_id.startswith("ocw-") and OCW_MARKER in markup
    if ocw:
        # Starting at the attribute preserves the literal first line of the original.
        markup = markup[markup.index(OCW_MARKER):]

    parser = SyllabusHTML()
    parser.feed(markup)
    parser.close()
    text = html.unescape("".join(parser.parts)).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    if ocw:
        if case_id in OCW_WITH_COURSE_INFO:
            text = text.rsplit("\nCourse Info", 1)[0]
        else:
            text = re.split(r"\nCourse Info\s*\n\s*Instructor", text, maxsplit=1)[0]
        text = re.sub(r"\n\s*\|\s*\n", "\n", text).strip()
        term_code = case_id.rsplit("-", 1)[-1]
        term = {"f": "Fall", "s": "Spring"}[term_code[0]]
        text = f"{course}, {term} {term_code[1:]} - Syllabus (MIT OpenCourseWare)\n\n{text}"
    return text


def extract_pdf(body):
    pages = []
    for page in PdfReader(io.BytesIO(body)).pages:
        try:
            pages.append(page.extract_text(extraction_mode="layout"))
        except Exception:
            pages.append(page.extract_text())
    return "\n".join(pages)


def omit_between(text, start, end):
    first = re.search(start, text)
    if first:
        last = re.search(end, text[first.end():])
        if last:
            return text[:first.start()] + text[first.end() + last.start():]
    return text


def prepare_case(text, case_id, course):
    text = text.replace("\x00", "").replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # This case kept four ranges from the pre-normalized grading and calendar page.
    if case_id == "cmu-10701-s2026":
        lines = text.split("\n")
        if len(lines) >= 1045 and lines[1044] == "Course Calendar":
            ranges = [(180, 253), (296, 312), (690, 960), (975, 1045)]
            sections = [
                "\n".join(line for line in lines[start - 1:end] if line.strip())
                for start, end in ranges
            ]
            title = f"{lines[0]}: {course.removeprefix('10-701 ')}"
            text = "\n\n".join([title, *sections])

    text = re.sub(r"(?<=\S) {3,}", "  ", text)
    text = re.sub(r"^ {5,}", "    ", text, flags=re.MULTILINE)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    # The original dataset omitted some administrative material to retain grading and dates.
    match case_id:
        case "cu-econ2010-f2025":
            text = omit_between(text, r"\n\s*1\.\s+LECTURE\n", r"\nGRADING")
            text = omit_between(text, "Lecture participation accounts for", r"\n[^\n]*A  ≥ 94%")
        case "uva-econ3010-f2025":
            if text.startswith("Activities (", 11292) and text.startswith("Tentative Schedule", 17166):
                text = "\n\n".join([
                    text[:2200].rsplit("\n", 1)[0],
                    text[5600:9300].rsplit("\n", 1)[0],
                    text[11292:13907],
                    text[17166:],
                ])
        case "sjsu-cs46b-f2025" | "nu-econ309-f2025":
            start = r"CS 46B|Section 3" if case_id.startswith("sjsu-") else "ECON 309"
            if heading := re.search(start, text):
                text = text[heading.start():]
        case "sjsu-engl1a-f2025":
            text = omit_between(text, r"Course Learning Outcomes \(CLOs\)", "Writing Practice:")
        case "grinnell-hist295-f2024":
            head, heading, schedule = text.partition("Course Schedule:")
            if heading:
                head = omit_between(head, "Open Office hours", "Grading:")
                entries = re.compile(
                    r"^(Course Schedule|Week |Monday|Tuesday|Wednesday|Thursday|Friday|"
                    r"Blog post|Primary|Final Project|Before you come|Program)"
                )
                text = head + "\n".join(
                    line for line in (heading + schedule).split("\n") if entries.match(line.strip())
                )
        case "rpi-csci1200-f2024":
            text = re.sub(r"\n-\s*(?=\n)", "", text)
            text = re.sub(r"\n{3,}", "\n\n", text)
            if (start := text.find("There will be")) >= 0:
                text = text.split("\n", 1)[0] + "\n\n" + text[start:]

    if not text.strip():
        raise ValueError("no syllabus text found")
    if len(text) > MAX_CHARS:
        prefix = text[:MAX_CHARS]
        text = prefix.rpartition("\n")[0] or prefix
    return (text + "\n").encode("utf-8")


def load_sources():
    sources = {}
    for line in (EVAL_DIR / "SOURCES.md").read_text(encoding="utf-8").splitlines():
        columns = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(columns) == 5 and columns[0] != "id" and CASE_ID.fullmatch(columns[0]):
            case_id, _, course, url, _ = columns
            sources[case_id] = (course, url.strip("<>"))
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out", type=Path, default=EVAL_DIR / "cases", help="output directory (default: eval/cases)"
    )
    parser.add_argument("--only", action="append", metavar="ID", help="fetch only this label ID (repeatable)")
    parser.add_argument("--check", action="store_true", help="compare fetched files to eval/cases.sha256")
    args = parser.parse_args()

    try:
        labels = (EVAL_DIR / "labels.jsonl").read_text(encoding="utf-8")
        ids = [json.loads(line)["id"] for line in labels.splitlines() if line.strip()]
        sources = load_sources()
        hashes = {}
        if args.check:
            for line in (EVAL_DIR / "cases.sha256").read_text(encoding="ascii").splitlines():
                digest, filename = line.split()
                hashes[filename] = digest
        args.out.mkdir(parents=True, exist_ok=True)
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))

    if unknown := set(args.only or []) - set(ids):
        parser.error("unknown label ID(s): " + ", ".join(sorted(unknown)))
    selected = set(args.only or ids)
    failed = False
    sent_request = False

    def pace_request(_request):
        nonlocal sent_request
        if sent_request:
            time.sleep(1)
        sent_request = True

    logging.getLogger("pypdf").setLevel(logging.ERROR)
    with httpx.Client(
        headers={"User-Agent": "syllabus-term-eval/1.0"},
        timeout=httpx.Timeout(20.0, connect=10.0),
        follow_redirects=True,
        max_redirects=10,
        event_hooks={"request": [pace_request]},
    ) as client:
        for case_id in ids:
            if case_id not in selected:
                continue
            filename = f"{case_id}.txt"
            try:
                course, url = sources[case_id]
                response = client.get(url)
                response.raise_for_status()
                body = response.content
                media_type = response.headers.get("content-type", "").split(";", 1)[0].lower().strip()
                if body.startswith(b"%PDF"):
                    text = extract_pdf(body)
                elif media_type in {"text/html", "application/xhtml+xml"} or body.lstrip().startswith(b"<"):
                    text = extract_html(body, case_id, course)
                else:
                    raise ValueError(f"unsupported response type: {media_type or 'unspecified'}")
                contents = prepare_case(text, case_id, course)
                (args.out / filename).write_bytes(contents)
            except Exception as error:
                print(f"{case_id}: failed ({type(error).__name__}: {error})", flush=True)
                failed = True
                continue

            status = "fetched"
            if args.check:
                expected = hashes.get(filename)
                matched = hashlib.sha256(contents).hexdigest() == expected
                status += ", match" if matched else ", mismatch"
                if expected is None:
                    status += " (no reference hash)"
                failed |= not matched
            print(f"{case_id}: {status}", flush=True)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
