"""Dependency DAG construction, Kahn's topo sort, cycle detection, P0/P1/P2 prioritization."""
from __future__ import annotations

import re
from typing import Any

RISK_HINTS = ["security", "data loss", "regression", "incident", "compliance"]
DEP_PHRASES = [
    re.compile(r"depends on\s+([A-Za-z0-9_/.\- #]+)", re.IGNORECASE),
    re.compile(r"blocked by\s+([A-Za-z0-9_/.\- #]+)", re.IGNORECASE),
    re.compile(r"requires\s+([A-Za-z0-9_/.\- #]+?)\s+to land", re.IGNORECASE),
    re.compile(r"after\s+([A-Za-z0-9_/.\- #]+?)\s+lands", re.IGNORECASE),
    re.compile(r"consumes\s+([A-Za-z0-9_/.\- #]+)", re.IGNORECASE),
]


def _node_id(feature_id: str, story_id: str) -> str:
    return f"F{feature_id}.S{story_id}"


def _extract_inline_deps(text: str) -> list[str]:
    if not text:
        return []
    ids: set[str] = set()
    for pat in DEP_PHRASES:
        for m in pat.finditer(text):
            ref = m.group(1).strip()
            ext = re.match(r"F(\d+)[ .\-]?S?(\d+)?", ref, re.IGNORECASE)
            if ext:
                if ext.group(2):
                    ids.add(f"F{ext.group(1).zfill(2)}.S{ext.group(2).zfill(2)}")
                else:
                    ids.add(f"F{ext.group(1).zfill(2)}")
    return list(ids)


def _normalize_dep_ref(raw: str, current_feature_id: str | None) -> str | None:
    m = re.search(r"F(\d+)[ .\-/]?S?(\d+)?", raw, re.IGNORECASE)
    if m:
        if m.group(2):
            return f"F{m.group(1).zfill(2)}.S{m.group(2).zfill(2)}"
        return f"F{m.group(1).zfill(2)}"
    sm = re.search(r"S(\d+)", raw, re.IGNORECASE)
    if sm and current_feature_id:
        return f"F{current_feature_id}.S{sm.group(1).zfill(2)}"
    return None


def build_dag(plan: dict[str, Any], implicit: bool = True) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    node_map: dict[str, dict[str, Any]] = {}

    for feature in plan["features"]:
        for story in feature["stories"]:
            nid = _node_id(feature["id"], story["id"])
            node = {
                "id": nid,
                "type": "story",
                "featureId": feature["id"],
                "storyId": story["id"],
                "slug": story["slug"],
                "path": story["path"],
                "acceptanceCriteria": story["acceptanceCriteria"],
                "taskCount": len(story["tasks"]),
                "risk": _detect_risk(story),
            }
            nodes.append(node)
            node_map[nid] = node

    for fi, feature in enumerate(plan["features"]):
        for i, story in enumerate(feature["stories"]):
            nid = _node_id(feature["id"], story["id"])
            feature_padded = feature["id"].zfill(2)
            explicit_raw = [_normalize_dep_ref(d, feature_padded) for d in (story.get("dependencies") or [])]
            explicit = [d for d in explicit_raw if d is not None]
            inline = [d for d in _extract_inline_deps(story.get("context", "")) if "." in d]
            declared_none = not (story.get("dependencies") or [])

            all_deps: set[str] = set(explicit) | set(inline)

            if implicit and declared_none and i > 0:
                prev = feature["stories"][i - 1]
                all_deps.add(_node_id(feature["id"], prev["id"]))

            if implicit and story["id"] == "01" and fi > 0:
                prev_feature = plan["features"][fi - 1]
                if prev_feature["stories"]:
                    last_prev = prev_feature["stories"][-1]
                    all_deps.add(_node_id(prev_feature["id"], last_prev["id"]))

            for src in all_deps:
                if src in node_map and src != nid:
                    edges.append({"from": src, "to": nid})

    return {"nodes": nodes, "edges": edges, "nodeMap": node_map}


def _detect_risk(story: dict[str, Any]) -> list[str]:
    hay = (story.get("context", "") + " " + " ".join(story["acceptanceCriteria"])).lower()
    return [h for h in RISK_HINTS if h in hay]


def topo_sort(dag: dict[str, Any]) -> dict[str, Any]:
    nodes = dag["nodes"]
    edges = dag["edges"]
    indeg: dict[str, int] = {n["id"]: 0 for n in nodes}
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        if e["to"] not in indeg or e["from"] not in adj:
            continue
        indeg[e["to"]] += 1
        adj[e["from"]].append(e["to"])
    queue = sorted([i for i, d in indeg.items() if d == 0])
    order: list[str] = []
    while queue:
        cur = queue.pop(0)
        order.append(cur)
        for nxt in adj.get(cur, []):
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
                queue.sort()
    cycles = [] if len(order) == len(nodes) else _find_cycles(dag)
    return {"order": order, "cycles": cycles}


def _find_cycles(dag: dict[str, Any]) -> list[list[str]]:
    nodes = dag["nodes"]
    edges = dag["edges"]
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        if e["from"] in adj:
            adj[e["from"]].append(e["to"])
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {n["id"]: WHITE for n in nodes}
    cycles: list[list[str]] = []
    stack: list[str] = []

    def dfs(u: str) -> None:
        color[u] = GRAY
        stack.append(u)
        for v in adj.get(u, []):
            if color.get(v) == GRAY:
                idx = stack.index(v)
                cycles.append(stack[idx:] + [v])
            elif color.get(v) == WHITE:
                dfs(v)
        stack.pop()
        color[u] = BLACK

    for n in nodes:
        if color[n["id"]] == WHITE:
            dfs(n["id"])
    return cycles


def prioritize(dag: dict[str, Any], topo: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = dag["nodes"]
    edges = dag["edges"]
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        adj.setdefault(e["from"], []).append(e["to"])
    downstream: dict[str, int] = {}

    def count(nid: str, seen: set[str] | None = None) -> int:
        if nid in downstream:
            return downstream[nid]
        if seen is None:
            seen = set()
        if nid in seen:
            return 0
        seen.add(nid)
        c = 0
        for v in adj.get(nid, []):
            c += 1 + count(v, seen)
        downstream[nid] = c
        return c

    for n in nodes:
        count(n["id"])

    out: list[dict[str, Any]] = []
    for n in nodes:
        blockers = downstream.get(n["id"], 0)
        tier = "P2"
        if blockers >= 3:
            tier = "P1"
        if blockers >= 6:
            tier = "P0"
        if n["risk"] and tier == "P1":
            tier = "P0"
        out.append({**n, "blockersDownstream": blockers, "tier": tier})
    order_map = {"P0": 0, "P1": 1, "P2": 2}
    out.sort(key=lambda r: (order_map[r["tier"]], -r["blockersDownstream"], r["id"]))
    return out
