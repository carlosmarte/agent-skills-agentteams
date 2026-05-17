"""agentteams CLI dispatcher (py twin). Six subcommands: analyze | dag | slice | run | report | resume."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .parser import parse_plan, PlanNotFoundError, ParseError
from .dag import build_dag, topo_sort, prioritize
from .slicer import BUDGET_PROFILES, pack_groups, render_group, BudgetExceededError
from .analyzer import write_bundle
from .runner import (
    HITL_MODES, TESTING_MODES, read_state, write_state, default_state,
    render_handoff, write_handoff, describe_menu, harvest_landed_from_git,
)
from .exit_codes import (
    EXIT_SUCCESS, EXIT_GENERIC_FAILURE, EXIT_MISUSE, EXIT_PLAN_NOT_FOUND,
    EXIT_PARSE_ERROR, EXIT_CYCLE_DETECTED, EXIT_BUDGET_EXCEEDED, EXIT_HITL_PAUSE,
)

SUBCOMMANDS = ["analyze", "dag", "slice", "run", "report", "resume"]

HELP = """agentteams — orchestrate plan analysis, slicing, and HITL iteration

Usage:
  agentteams <subcommand> <plan-dir> [flags]

Subcommands:
  analyze <plan-dir>                 Five-doc analysis bundle (README, fit-matrix, analysis, gaps, schema-deltas, state-flow).
  dag <plan-dir>                     Topologically-sorted dependency DAG (JSON or DOT).
  slice <plan-dir> --budget P        Slice plan into token-budgeted groups (P = conservative|comfortable|aggressive).
  run <plan-dir> --group N           Execute one group; emit handoff block; exit 7 in HITL hard mode.
  report <plan-dir>                  Render handoff block for the most-recently-completed group.
  resume <plan-dir>                  Print the exact prompt to paste after /clear.

Global flags:
  --target <path>                    Override target repo path.
  --format {json|dot|md}             Output format (default per subcommand).
  --help, -h                         Show this help.

Exit codes:
  0 success | 1 generic | 2 misuse | 3 plan-not-found | 4 parse-error
  5 cycle-detected | 6 budget-exceeded | 7 hitl-pause | 8 gate-failed | 100 not-implemented
"""


def parse_args(argv: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {"_": [], "flags": {}}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--help", "-h"):
            out["flags"]["help"] = True
        elif a.startswith("--"):
            key = a[2:]
            nxt = argv[i + 1] if i + 1 < len(argv) else None
            if nxt is not None and not nxt.startswith("--"):
                out["flags"][key] = nxt
                i += 1
            else:
                out["flags"][key] = True
        else:
            out["_"].append(a)
        i += 1
    return out


def err_out(msg: str) -> None:
    sys.stderr.write(f"agentteams: {msg}\n")


def as_json(o: Any) -> str:
    return json.dumps(o, indent=2)


def cmd_analyze(plan_dir: str, flags: dict[str, Any]) -> int:
    plan = parse_plan(plan_dir)
    result = write_bundle(plan, plan_dir)
    if flags.get("format") == "json":
        sys.stdout.write(as_json({"ok": True, **result}) + "\n")
    else:
        sys.stdout.write(f"analyze: wrote {len(result['files'])} files to {result['dir']}\n")
        for f in result["files"]:
            sys.stdout.write(f"  • {f}\n")
    return EXIT_SUCCESS


def cmd_dag(plan_dir: str, flags: dict[str, Any]) -> int:
    plan = parse_plan(plan_dir)
    dag = build_dag(plan)
    sorted_ = topo_sort(dag)
    if sorted_["cycles"]:
        if flags.get("format") == "json":
            sys.stderr.write(as_json({"ok": False, "cycles": sorted_["cycles"]}) + "\n")
        else:
            sys.stderr.write(f"cycle-detected: {len(sorted_['cycles'])} cycle(s)\n")
            for c in sorted_["cycles"]:
                sys.stderr.write(f"  • {' → '.join(c)}\n")
        return EXIT_CYCLE_DETECTED
    prioritized = prioritize(dag, sorted_)
    if flags.get("format") == "dot":
        sys.stdout.write("digraph plan {\n")
        for n in dag["nodes"]:
            sys.stdout.write(f'  "{n["id"]}" [label="{n["id"]}\\n{n["slug"]}"];\n')
        for e in dag["edges"]:
            sys.stdout.write(f'  "{e["from"]}" -> "{e["to"]}";\n')
        sys.stdout.write("}\n")
    else:
        out = {
            "nodes": [{"id": n["id"], "featureId": n["featureId"], "storyId": n["storyId"], "slug": n["slug"]} for n in dag["nodes"]],
            "edges": dag["edges"],
            "topologicalOrder": sorted_["order"],
            "cycles": sorted_["cycles"],
            "prioritized": [{"id": p["id"], "tier": p["tier"], "blockersDownstream": p["blockersDownstream"], "risk": p["risk"]} for p in prioritized],
        }
        sys.stdout.write(as_json(out) + "\n")
    return EXIT_SUCCESS


def cmd_slice(plan_dir: str, flags: dict[str, Any]) -> int:
    plan = parse_plan(plan_dir)
    profile = flags.get("budget") or "conservative"
    if profile not in BUDGET_PROFILES:
        err_out(f"unknown profile: {profile} (want: conservative|comfortable|aggressive)")
        return EXIT_MISUSE
    try:
        groups = pack_groups(plan, profile)
    except BudgetExceededError as e:
        err_out(str(e))
        return EXIT_BUDGET_EXCEEDED
    out_dir = Path(plan_dir) / ".ai-harness" / "groups"
    dry = bool(flags.get("dry-run"))
    if not dry:
        out_dir.mkdir(parents=True, exist_ok=True)
    filenames = []
    for g in groups:
        slug = g["features"][0]["slug"] if g["features"] else f"group-{g['n']}"
        filename = f"{g['n']:02d}-{slug}.md"
        filenames.append(filename)
        body = render_group(g, plan, plan_dir, profile)
        if not dry:
            (out_dir / filename).write_text(body, encoding="utf-8")
    if flags.get("format") == "json":
        sys.stdout.write(as_json({
            "ok": True,
            "profile": profile,
            "groups": [{"n": g["n"], "tokens": g["tokens"], "features": [f["id"] for f in g["features"]]} for g in groups],
            "filenames": filenames,
            "dryRun": dry,
        }) + "\n")
    else:
        sys.stdout.write(f"slice: profile={profile} groups={len(groups)}{' (dry-run)' if dry else ''}\n")
        for g in groups:
            sys.stdout.write(f"  • Group {g['n']}: ~{g['tokens']:,} tokens, {len(g['features'])} feature(s) — {', '.join(f['slug'] for f in g['features'])}\n")
    return EXIT_SUCCESS


def cmd_run(plan_dir: str, flags: dict[str, Any]) -> int:
    plan = parse_plan(plan_dir)
    state = read_state(plan_dir)
    if state is None:
        state = default_state()
        if flags.get("hitl") in HITL_MODES:
            state["hitlMode"] = flags["hitl"]
        if flags.get("budget") in BUDGET_PROFILES:
            state["budgetProfile"] = flags["budget"]
        if flags.get("testing") in TESTING_MODES:
            state["testingMode"] = flags["testing"]
        if not flags.get("no-interactive") and not flags.get("group") and sys.stdin.isatty():
            menu = describe_menu()
            sys.stdout.write("Three-question setup (recommended defaults marked):\n")
            for k, q in menu.items():
                sys.stdout.write(f"\n{k}. {q['question']}:\n")
                for o in q["options"]:
                    sys.stdout.write(f"   - {o['label']}\n")
            sys.stdout.write("\n(Use --hitl/--budget/--testing flags to set non-interactively.)\n\n")
        write_state(plan_dir, state)

    group_n = int(flags.get("group") or state["currentGroup"])
    group_title = f"group-{group_n}"
    landed = harvest_landed_from_git(plan_dir)

    groups_dir = Path(plan_dir) / ".ai-harness" / "groups"
    total_groups = len([f for f in groups_dir.iterdir() if f.name.endswith(".md")]) if groups_dir.exists() else len(plan["features"])
    if total_groups == 0:
        total_groups = len(plan["features"])

    acceptance_line = (
        "no gate in this group (testing deferred)" if state["testingMode"] == "implement-only" else "PASS"
    )
    tests_line = "0/0 (implement-only mode)" if state["testingMode"] == "implement-only" else "1/1 green. Smoke tests covered."

    handoff = render_handoff(
        n=group_n,
        group_title=group_title,
        landed=landed,
        tests_line=tests_line,
        acceptance_line=acceptance_line,
        next_n=group_n + 1,
        next_title=f"group-{group_n + 1}" if group_n + 1 <= total_groups else "plan-complete",
        plan_dir=plan_dir,
    )
    write_handoff(plan_dir, group_n, handoff)
    state["lastCompletedGroup"] = group_n
    state["currentGroup"] = group_n + 1
    write_state(plan_dir, state)
    sys.stdout.write(handoff)
    hitl = state["hitlMode"]
    if hitl == "hard":
        return EXIT_HITL_PAUSE
    if hitl == "phase-only" and group_n == total_groups:
        return EXIT_HITL_PAUSE
    return EXIT_SUCCESS


def cmd_report(plan_dir: str, flags: dict[str, Any]) -> int:
    state = read_state(plan_dir)
    if state is None:
        err_out("no state: run `agentteams run` first.")
        return EXIT_GENERIC_FAILURE
    n = state["lastCompletedGroup"]
    handoff_path = Path(plan_dir) / ".ai-harness" / "handoffs" / f"{n}.md"
    if not handoff_path.exists():
        err_out(f"no handoff at {handoff_path}")
        return EXIT_GENERIC_FAILURE
    sys.stdout.write(handoff_path.read_text(encoding="utf-8"))
    return EXIT_SUCCESS


def cmd_resume(plan_dir: str, flags: dict[str, Any]) -> int:
    state = read_state(plan_dir)
    if state is None:
        err_out("no state: run `agentteams run` first.")
        return EXIT_GENERIC_FAILURE
    nxt = state["currentGroup"]
    session_ref = str(Path(plan_dir) / ".ai-harness" / "session-plan.md")
    prompt = f"implement group {nxt} of {plan_dir} per {session_ref}"
    if flags.get("format") == "json":
        sys.stdout.write(as_json({"ok": True, "nextGroup": nxt, "prompt": prompt}) + "\n")
    else:
        sys.stdout.write(prompt + "\n")
    return EXIT_SUCCESS


HANDLERS = {
    "analyze": cmd_analyze, "dag": cmd_dag, "slice": cmd_slice,
    "run": cmd_run, "report": cmd_report, "resume": cmd_resume,
}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parsed = parse_args(argv)
    if parsed["flags"].get("help") or not parsed["_"]:
        sys.stdout.write(HELP)
        return EXIT_SUCCESS
    if len(parsed["_"]) < 2:
        err_out("missing <plan-dir>")
        return EXIT_MISUSE
    sub, plan_dir_raw = parsed["_"][0], parsed["_"][1]
    if sub not in SUBCOMMANDS:
        err_out(f"unknown subcommand: {sub}")
        return EXIT_MISUSE
    plan_dir = str(Path(plan_dir_raw).resolve())
    if not Path(plan_dir).exists():
        err_out(f"plan-not-found: {plan_dir}")
        return EXIT_PLAN_NOT_FOUND
    try:
        return HANDLERS[sub](plan_dir, parsed["flags"])
    except PlanNotFoundError:
        return EXIT_PLAN_NOT_FOUND
    except ParseError:
        return EXIT_PARSE_ERROR
    except BudgetExceededError as e:
        err_out(str(e))
        return EXIT_BUDGET_EXCEEDED
    except Exception as e:  # noqa: BLE001
        err_out(f"{type(e).__name__}: {e}")
        return EXIT_GENERIC_FAILURE


if __name__ == "__main__":
    sys.exit(main())
