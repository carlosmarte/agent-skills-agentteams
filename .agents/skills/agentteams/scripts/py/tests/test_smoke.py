"""Smoke tests mirror mjs/test/smoke.test.mjs (sibling under the skill's scripts/)."""
from __future__ import annotations

from pathlib import Path

import pytest

from agentteams import (
    BUDGET_PROFILES,
    EXIT_CODES,
    build_dag,
    default_state,
    pack_groups,
    parse_plan,
    prioritize,
    render_handoff,
    topo_sort,
    write_bundle,
)

FIXTURE = Path(__file__).resolve().parents[4] / "agentteams-assets" / "fixtures" / "plans" / "minimal-plan"


def test_exit_codes_matrix() -> None:
    assert EXIT_CODES["SUCCESS"] == 0
    assert EXIT_CODES["HITL_PAUSE"] == 7
    assert EXIT_CODES["GATE_FAILED"] == 8
    assert EXIT_CODES["NOT_IMPLEMENTED"] == 100


def test_budget_profiles() -> None:
    assert BUDGET_PROFILES["conservative"]["maxTokens"] == 120000
    assert BUDGET_PROFILES["comfortable"]["maxTokens"] == 180000
    assert BUDGET_PROFILES["aggressive"]["maxTokens"] == 250000


def test_parse_plan_reads_fixture() -> None:
    plan = parse_plan(FIXTURE)
    assert len(plan["features"]) >= 1
    assert len(plan["features"][0]["stories"]) >= 1


def test_dag_no_cycles_on_minimal() -> None:
    plan = parse_plan(FIXTURE)
    dag = build_dag(plan)
    sorted_ = topo_sort(dag)
    assert sorted_["cycles"] == []
    assert len(sorted_["order"]) == len(dag["nodes"])


def test_prioritize_assigns_tier() -> None:
    plan = parse_plan(FIXTURE)
    dag = build_dag(plan)
    sorted_ = topo_sort(dag)
    prio = prioritize(dag, sorted_)
    for p in prio:
        assert p["tier"] in ("P0", "P1", "P2")


def test_pack_groups_conservative_budget() -> None:
    plan = parse_plan(FIXTURE)
    groups = pack_groups(plan, "conservative")
    assert len(groups) >= 1
    for g in groups:
        assert g["tokens"] <= BUDGET_PROFILES["conservative"]["maxTokens"] * 1.10


def test_write_bundle_emits_six_files() -> None:
    plan = parse_plan(FIXTURE)
    result = write_bundle(plan, str(FIXTURE))
    assert len(result["files"]) == 6
    for e in ("README.md", "fit-matrix.md", "analysis.md", "gaps-p0-p1-p2.md", "schema-deltas.md", "state-flow.md"):
        assert e in result["files"]


def test_render_handoff_shape() -> None:
    out = render_handoff(
        n=1,
        group_title="Schema Foundation",
        landed=[{"id": "F01", "description": "scaffold", "testStatus": "green", "fileCount": 3, "files": ["a", "b", "c"]}],
        tests_line="3/3 green. Smoke covered.",
        acceptance_line="PASS",
        next_n=2,
        next_title="Analyzer",
        plan_dir="/tmp/plan",
    )
    assert "GROUP 1 COMPLETE" in out
    assert "To resume:" in out
    assert "implement group 2 of /tmp/plan" in out


def test_default_state_schema_version() -> None:
    s = default_state()
    assert s["schemaVersion"] == 1
    assert s["currentGroup"] == 1
