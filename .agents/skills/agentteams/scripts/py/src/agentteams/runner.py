"""Orchestrator loop: HITL prompts, testing gates, state persistence, handoff renderer, resume."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HITL_MODES = ["hard", "soft", "phase-only"]
TESTING_MODES = ["tests+gate", "implement-only", "granular"]
STATE_SCHEMA_VERSION = 1


def state_file_path(plan_dir: str) -> Path:
    return Path(plan_dir) / ".ai-harness" / "state.json"


def read_state(plan_dir: str) -> dict[str, Any] | None:
    p = state_file_path(plan_dir)
    if not p.exists():
        return None
    raw = json.loads(p.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != STATE_SCHEMA_VERSION:
        raise ValueError(f"stale-state-schema: got {raw.get('schemaVersion')}, want {STATE_SCHEMA_VERSION}")
    return raw


def write_state(plan_dir: str, state: dict[str, Any]) -> dict[str, Any]:
    p = state_file_path(plan_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    merged = {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        **state,
    }
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    os.replace(tmp, p)
    return merged


def default_state() -> dict[str, Any]:
    return {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "currentGroup": 1,
        "lastCompletedGroup": 0,
        "hitlMode": "hard",
        "budgetProfile": "conservative",
        "testingMode": "tests+gate",
        "phaseAcceptanceGates": {},
    }


def render_handoff(*, n: int, group_title: str, landed: list[dict[str, Any]],
                   tests_line: str, acceptance_line: str, next_n: int, next_title: str,
                   plan_dir: str, session_plan_path: str | None = None) -> str:
    landed_block = "\n".join(
        f"- {l['id']}: {l['description']} — tests {l['testStatus']}, {l['fileCount']} files\n  • "
        + "\n  • ".join(l.get("files") or [])
        for l in landed
    ) or "(no landed items recorded)"
    session_ref = session_plan_path or f"{plan_dir}/.ai-harness/session-plan.md"
    return (
        f"GROUP {n} COMPLETE — {group_title}\n\n"
        f"Landed: {landed_block}\n\n"
        f"Tests: {tests_line}\n\n"
        f"Acceptance: {acceptance_line}\n\n"
        f"Next: GROUP {next_n} — {next_title}\n\n"
        f"To resume: 1) Run /clear to drop this session's context. 2) Paste this prompt:\n\n"
        f"       implement group {next_n} of {plan_dir} per {session_ref}\n"
    )


def write_handoff(plan_dir: str, n: int, body: str) -> Path:
    d = Path(plan_dir) / ".ai-harness" / "handoffs"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{n}.md"
    p.write_text(body, encoding="utf-8")
    return p


def describe_menu() -> dict[str, dict[str, Any]]:
    return {
        "q1": {
            "header": "Token budget",
            "question": "Target token budget per group",
            "options": [
                {"label": "Conservative ~120k (Recommended)", "value": "conservative"},
                {"label": "Comfortable ~180k", "value": "comfortable"},
                {"label": "Aggressive ~250k", "value": "aggressive"},
            ],
        },
        "q2": {
            "header": "HITL pause",
            "question": "How should I pause between groups",
            "options": [
                {"label": "Hard stop with re-entry prompt (Recommended)", "value": "hard"},
                {"label": "Soft stop — wait for confirmation", "value": "soft"},
                {"label": "Only pause at phase boundaries", "value": "phase-only"},
            ],
        },
        "q3": {
            "header": "Acceptance",
            "question": "Should each group end with acceptance-gate verification",
            "options": [
                {"label": "Run tests + acceptance gate when one fits (Recommended)", "value": "tests+gate"},
                {"label": "Implement only, defer testing", "value": "implement-only"},
                {"label": "Tests after every feature, gate after every phase", "value": "granular"},
            ],
        },
    }


def harvest_landed_from_git(plan_dir: str, since_ref: str = "HEAD~1") -> list[dict[str, Any]]:
    return [{
        "id": "F?",
        "description": "group landed (git harvest stub)",
        "testStatus": "green",
        "fileCount": 0,
        "files": [],
    }]
