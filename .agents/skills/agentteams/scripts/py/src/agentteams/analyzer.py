"""Plan analyzer: five-document bundle writer."""
from __future__ import annotations

import re
import uuid as _uuid
from pathlib import Path
from typing import Any

DEFAULT_EXPECTATIONS = [
    "schema-present",
    "tests-present",
    "acceptance-gate-defined",
    "dependencies-declared",
    "examples-present",
]


def _load_expectations(plan_dir: str) -> list[str]:
    cfg = Path(plan_dir) / ".agentteams" / "expectations.yaml"
    if not cfg.exists():
        return list(DEFAULT_EXPECTATIONS)
    out: list[str] = []
    for line in cfg.read_text(encoding="utf-8").split("\n"):
        m = re.match(r"^\s*-\s+(.+?)\s*$", line)
        if m:
            out.append(m.group(1))
    return out or list(DEFAULT_EXPECTATIONS)


def _check_expectation(name: str, plan: dict[str, Any]) -> list[dict[str, Any]]:
    surfaces: list[dict[str, Any]] = []
    for f in plan["features"]:
        status = "❌"
        hay = (
            "\n".join(f["acceptanceCriteria"])
            + " "
            + " ".join(a for s in f["stories"] for a in s["acceptanceCriteria"])
        ).lower()
        if name == "schema-present" and re.search(r"schema|ast|frontmatter|matrix|json", hay):
            status = "✅"
        elif name == "tests-present" and re.search(r"test|parity|gate|verify", hay):
            status = "✅"
        elif name == "acceptance-gate-defined" and re.search(r"acceptance|gate|exit 0|exit 7|byte-equal", hay):
            status = "✅"
        elif name == "dependencies-declared" and any(s.get("dependencies") for s in f["stories"]):
            status = "✅"
        elif name == "examples-present" and re.search(r"example|fixture|golden|replay", hay):
            status = "✅"
        if status == "❌" and re.search(r"partial|stub|placeholder", hay):
            status = "🟡"
        surfaces.append({"featureId": f["id"], "slug": f["slug"], "status": status, "evidence": [f"{f['path']}:1"]})
    return surfaces


def build_fit_matrix(plan: dict[str, Any], expectations: list[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    expectations = expectations or DEFAULT_EXPECTATIONS
    return {name: _check_expectation(name, plan) for name in expectations}


def render_fit_matrix(matrix: dict[str, list[dict[str, Any]]], plan: dict[str, Any]) -> str:
    expectations = list(matrix.keys())
    features = plan["features"]
    header = "| Expectation | " + " | ".join(f"F{f['id']}" for f in features) + " |"
    sep = "| ---: | " + " | ".join(":---:" for _ in features) + " |"
    rows = [
        f"| {exp} | " + " | ".join(s["status"] for s in matrix[exp]) + " |"
        for exp in expectations
    ]
    out = ["# Fit Matrix", "", header, sep, *rows, "", "## Evidence", ""]
    for exp in expectations:
        out.append(f"\n### {exp}\n")
        for surface in matrix[exp]:
            out.append(f"- F{surface['featureId']} ({surface['slug']}): {surface['status']} — {', '.join(surface['evidence'])}")
    return "\n".join(out) + "\n"


def render_analysis(plan: dict[str, Any]) -> str:
    parts = ["# Analysis", "", f"Plan: `{plan['planDir']}`", ""]
    for f in plan["features"]:
        parts.append(f"## F{f['id']} — {f['slug']}\n")
        parts.append(f"Path: `{f['path']}`\n")
        parts.append(f"Stories: {len(f['stories'])} | Acceptance criteria: {len(f['acceptanceCriteria'])}\n")
        if f["acceptanceCriteria"]:
            parts.append("Acceptance criteria:")
            for ac in f["acceptanceCriteria"]:
                parts.append(f"- {ac}")
            parts.append("")
    return "\n".join(parts) + "\n"


def render_state_flow(plan: dict[str, Any]) -> str:
    out = ["# State Flow Audit", ""]
    pat = re.compile(r"([a-z][a-z_-]*\s*(?:→|->)\s*[a-z][a-z_ →\->]*)", re.IGNORECASE)
    found: list[str] = []
    for f in plan["features"]:
        body = "\n".join(f["acceptanceCriteria"] + [a for s in f["stories"] for a in s["acceptanceCriteria"]])
        for m in pat.finditer(body):
            found.append(f"- F{f['id']}: `{m.group(1)}`")
    if not found:
        out.append("_No state-machine transitions detected in plan acceptance criteria._")
    else:
        out.extend(found)
    return "\n".join(out) + "\n"


def render_schema_deltas(plan: dict[str, Any]) -> str:
    out = [
        "# Schema Deltas",
        "",
        "_Schema additions surfaced by gap analysis. Populated by F03 prioritizer._",
        "",
        "## Detected schema surfaces",
        "",
    ]
    any_found = False
    for f in plan["features"]:
        hay = "\n".join(f["acceptanceCriteria"] + [a for s in f["stories"] for a in s["acceptanceCriteria"]])
        hits = len(re.findall(r"schema|interface|type|AST|frontmatter", hay, re.IGNORECASE))
        if hits:
            out.append(f"- **F{f['id']}** ({f['slug']}): {hits} schema mentions in acceptance criteria.")
            any_found = True
    if not any_found:
        out.append("_No explicit schema deltas detected._")
    return "\n".join(out) + "\n"


def render_gaps_scaffold(plan: dict[str, Any]) -> str:
    return (
        "# Gaps — P0 / P1 / P2\n\n"
        "_Scaffold emitted by F02 (analyzer). Populated by F03 (DAG prioritizer)._\n\n"
        "## Punch list (placeholder)\n\n"
        "Run `agentteams dag <plan-dir>` to populate.\n"
    )


def render_readme(plan: dict[str, Any], bundle_dir: str) -> str:
    fc = len(plan["features"])
    sc = sum(len(f["stories"]) for f in plan["features"])
    tc = sum(len(s["tasks"]) for f in plan["features"] for s in f["stories"])
    wc = len(plan["warnings"])
    return (
        f"# Analysis bundle — `{plan['planDir']}`\n\n"
        "## Headline verdict\n\n"
        f"This plan declares **{fc} features**, **{sc} stories**, and **{tc} tasks**, "
        f"with **{wc} parser warnings**. Fit-matrix and gap punch list below.\n\n"
        "## Files in this bundle\n\n"
        "- `README.md` — this file (entry index + headline).\n"
        "- `fit-matrix.md` — expectation × surface scoreboard.\n"
        "- `analysis.md` — long-form per-feature walk-through.\n"
        "- `gaps-p0-p1-p2.md` — prioritized punch list (populated by `agentteams dag`).\n"
        "- `schema-deltas.md` — schema additions surfaced by analysis.\n"
        "- `state-flow.md` — state-machine audit.\n"
    )


def write_bundle(plan: dict[str, Any], out_root: str) -> dict[str, Any]:
    uid = str(_uuid.uuid4())
    out_dir = Path(out_root) / ".ai-harness" / "analysis" / uid
    out_dir.mkdir(parents=True, exist_ok=True)
    expectations = _load_expectations(plan["planDir"])
    matrix = build_fit_matrix(plan, expectations)
    files = {
        "README.md": render_readme(plan, str(out_dir)),
        "fit-matrix.md": render_fit_matrix(matrix, plan),
        "analysis.md": render_analysis(plan),
        "gaps-p0-p1-p2.md": render_gaps_scaffold(plan),
        "schema-deltas.md": render_schema_deltas(plan),
        "state-flow.md": render_state_flow(plan),
    }
    for name, body in files.items():
        (out_dir / name).write_text(body, encoding="utf-8")
    return {"uuid": uid, "dir": str(out_dir), "files": list(files.keys()), "matrix": matrix}
