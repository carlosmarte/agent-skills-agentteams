"""Plan-tree parser. Walks features/, stories/, tasks/ and emits a typed AST."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

RE_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
RE_CHECKBOX = re.compile(r"^\s*-\s*\[( |x|X)\]\s+(.+?)\s*$")
RE_BULLET = re.compile(r"^\s*-\s+(.+?)\s*$")
RE_TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")


class PlanNotFoundError(Exception):
    code = "PLAN_NOT_FOUND"


class ParseError(Exception):
    code = "PARSE_ERROR"


def _read_file(p: Path) -> str | None:
    try:
        return p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    block = text[4:end]
    body = text[end + 4 :].lstrip("\n")
    fm: dict[str, str] = {}
    for line in block.split("\n"):
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m:
            fm[m.group(1)] = m.group(2).strip()
    return fm, body


def parse_sections(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    current_h2: str | None = None
    buf: list[str] = []

    def flush() -> None:
        if current_h2 is not None:
            out[current_h2] = "\n".join(buf).strip()

    for line in body.split("\n"):
        m = RE_HEADING.match(line)
        if m and len(m.group(1)) == 2:
            flush()
            current_h2 = m.group(2).strip()
            buf = []
        else:
            buf.append(line)
    flush()
    return out


def parse_acceptance_criteria(section: str | None) -> list[str]:
    if not section:
        return []
    return [m.group(2) for line in section.split("\n") if (m := RE_CHECKBOX.match(line))]


def parse_table(section: str | None) -> list[dict[str, str]]:
    if not section:
        return []
    rows = [line for line in section.split("\n") if RE_TABLE_ROW.match(line)]
    if len(rows) < 2:
        return []
    headers = [c.strip().lower() for c in rows[0].split("|")[1:-1]]
    out: list[dict[str, str]] = []
    for line in rows[2:]:
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) == len(headers):
            out.append(dict(zip(headers, cells)))
    return out


def parse_bullets(section: str | None) -> list[str]:
    if not section:
        return []
    return [m.group(1) for line in section.split("\n") if (m := RE_BULLET.match(line))]


def parse_dependencies(section: str | None) -> list[str]:
    if not section:
        return []
    txt = section.strip()
    if re.match(r"^none\.?$", txt, re.IGNORECASE):
        return []
    bullets = parse_bullets(section)
    if len(bullets) == 1 and re.match(r"^none\.?$", bullets[0], re.IGNORECASE):
        return []
    return bullets


def _list_files(p: Path, ext: str = ".md") -> list[str]:
    if not p.exists():
        return []
    return sorted([f.name for f in p.iterdir() if f.is_file() and f.name.endswith(ext)])


def _parse_doc(file_path: Path) -> dict[str, Any] | None:
    text = _read_file(file_path)
    if text is None:
        return None
    fm, body = parse_frontmatter(text)
    return {
        "path": str(file_path),
        "frontmatter": fm,
        "body": body,
        "sections": parse_sections(body),
        "raw": text,
    }


def parse_plan(plan_dir: str | Path) -> dict[str, Any]:
    plan_path = Path(plan_dir)
    if not plan_path.exists():
        raise PlanNotFoundError(f"plan-not-found: {plan_dir}")
    warnings: list[dict[str, str]] = []
    readme = _parse_doc(plan_path / "README.md")
    if readme is None:
        warnings.append({"level": "WARN", "code": "no-readme", "path": str(plan_path / "README.md")})

    features_dir = plan_path / "features"
    stories_dir = plan_path / "stories"
    tasks_dir = plan_path / "tasks"

    features: list[dict[str, Any]] = []
    for fname in _list_files(features_dir):
        fpath = features_dir / fname
        doc = _parse_doc(fpath)
        if doc is None:
            continue
        m = re.match(r"^(\d+)", fname)
        fid = m.group(1) if m else fname
        slug = re.sub(r"^\d+-", "", fname).removesuffix(".md")
        ac = parse_acceptance_criteria(doc["sections"].get("Acceptance Criteria"))
        story_table = parse_table(doc["sections"].get("Stories"))

        feature_num = fid.zfill(2)
        story_dir = stories_dir / feature_num
        stories: list[dict[str, Any]] = []
        for sname in _list_files(story_dir):
            spath = story_dir / sname
            sdoc = _parse_doc(spath)
            if sdoc is None:
                continue
            sm = re.match(r"^(\d+)", sname)
            sid = sm.group(1) if sm else sname
            sslug = re.sub(r"^\d+-", "", sname).removesuffix(".md")
            sac = parse_acceptance_criteria(sdoc["sections"].get("Acceptance Criteria"))
            sdeps = parse_dependencies(sdoc["sections"].get("Dependencies"))
            task_dir = tasks_dir / feature_num / sid.zfill(2)
            task_files = _list_files(task_dir)
            if not task_files:
                warnings.append({"level": "WARN", "code": "tasks-not-expanded", "path": str(task_dir)})
            tasks: list[dict[str, Any]] = []
            for tname in task_files:
                tpath = task_dir / tname
                tdoc = _parse_doc(tpath)
                if tdoc is None:
                    continue
                tm = re.match(r"^(\d+)", tname)
                tid = tm.group(1) if tm else tname
                tslug = re.sub(r"^\d+-", "", tname).removesuffix(".md")
                tasks.append({
                    "id": tid,
                    "slug": tslug,
                    "path": str(tpath),
                    "targetFiles": parse_bullets(tdoc["sections"].get("Target Files")),
                    "verification": parse_acceptance_criteria(tdoc["sections"].get("Verification")),
                    "context": tdoc["sections"].get("Context", ""),
                    "changes": tdoc["sections"].get("Changes", ""),
                })
            stories.append({
                "id": sid,
                "slug": sslug,
                "path": str(spath),
                "featureId": fid,
                "acceptanceCriteria": sac,
                "dependencies": sdeps,
                "context": sdoc["sections"].get("Context", ""),
                "tasks": tasks,
            })
        features.append({
            "id": fid,
            "slug": slug,
            "path": str(fpath),
            "acceptanceCriteria": ac,
            "storyTable": story_table,
            "stories": stories,
        })

    return {
        "planDir": str(plan_path),
        "readme": ({"path": readme["path"], "sections": readme["sections"], "raw": readme["raw"]} if readme else None),
        "features": features,
        "warnings": warnings,
    }
