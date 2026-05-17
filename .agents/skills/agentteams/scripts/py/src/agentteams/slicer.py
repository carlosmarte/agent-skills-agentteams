"""Token estimator + budget profiles + greedy topological packer + group renderer."""
from __future__ import annotations

from pathlib import Path
from typing import Any

BUDGET_PROFILES: dict[str, dict[str, Any]] = {
    "conservative": {"maxTokens": 120000, "recommendedFeaturesPerGroup": [1, 3]},
    "comfortable": {"maxTokens": 180000, "recommendedFeaturesPerGroup": [2, 4]},
    "aggressive": {"maxTokens": 250000, "recommendedFeaturesPerGroup": [3, 5]},
}

CHAR_TO_TOKEN = 0.27
PLANNING_OVERHEAD = 0.15
TOOL_CALL_OVERHEAD = 0.20


class BudgetExceededError(Exception):
    code = "BUDGET_EXCEEDED"


def _file_chars(p: str) -> int:
    try:
        return Path(p).stat().st_size
    except FileNotFoundError:
        return 0


def estimate_task(task: dict[str, Any]) -> int:
    base = _file_chars(task["path"])
    tokens = base * CHAR_TO_TOKEN
    tokens *= 1 + PLANNING_OVERHEAD
    tool_calls = len(task.get("targetFiles") or [])
    tokens *= 1 + TOOL_CALL_OVERHEAD * tool_calls
    return round(tokens)


def estimate_story(story: dict[str, Any]) -> int:
    own = round(_file_chars(story["path"]) * CHAR_TO_TOKEN * (1 + PLANNING_OVERHEAD))
    tasks = sum(estimate_task(t) for t in (story.get("tasks") or []))
    return own + tasks


def estimate_feature(feature: dict[str, Any]) -> int:
    own = round(_file_chars(feature["path"]) * CHAR_TO_TOKEN * (1 + PLANNING_OVERHEAD))
    stories = sum(estimate_story(s) for s in feature["stories"])
    return own + stories


def pack_groups(plan: dict[str, Any], profile_name: str) -> list[dict[str, Any]]:
    profile = BUDGET_PROFILES.get(profile_name)
    if not profile:
        raise ValueError(f"unknown-profile: {profile_name}")
    budget = profile["maxTokens"]
    tolerance = budget * 1.10
    groups: list[dict[str, Any]] = []
    current: dict[str, Any] = {"features": [], "tokens": 0}

    for feature in plan["features"]:
        f_tokens = estimate_feature(feature)
        if f_tokens > tolerance:
            if current["features"]:
                groups.append(current)
                current = {"features": [], "tokens": 0}
            sub_feature = {**feature, "stories": []}
            sub_tokens = 0
            for story in feature["stories"]:
                s_tokens = estimate_story(story)
                if s_tokens > tolerance:
                    raise BudgetExceededError(
                        f"budget-exceeded: story {feature['id']}.{story['id']} (~{s_tokens}t) > {budget}t profile"
                    )
                if sub_tokens + s_tokens > tolerance:
                    groups.append({"features": [{**sub_feature, "_splitContinuation": True}], "tokens": sub_tokens})
                    sub_feature = {**feature, "stories": []}
                    sub_tokens = 0
                sub_feature["stories"].append(story)
                sub_tokens += s_tokens
            if sub_feature["stories"]:
                groups.append({"features": [sub_feature], "tokens": sub_tokens})
            continue
        if current["tokens"] + f_tokens > tolerance:
            groups.append(current)
            current = {"features": [], "tokens": 0}
        current["features"].append(feature)
        current["tokens"] += f_tokens
    if current["features"]:
        groups.append(current)
    return [{**g, "n": i + 1} for i, g in enumerate(groups)]


def render_group(group: dict[str, Any], plan: dict[str, Any], plan_dir: str, profile_name: str) -> str:
    feature_summary = "\n".join(
        f"- **F{f['id']}** — {f['slug']} ({len(f['stories'])} stories)" for f in group["features"]
    )
    acceptance_lines = "\n".join(
        f"- [ ] {a}" for f in group["features"] for a in f["acceptanceCriteria"]
    ) or "- [ ] (no acceptance criteria declared in member features)"
    next_n = group["n"] + 1
    resume_prompt = f"implement group {next_n} of {plan_dir} per {plan_dir}/.ai-harness/session-plan.md"
    titles = " + ".join(f["slug"] for f in group["features"])
    return f"""# Group {group['n']} — {titles}

## Goal

Implement {len(group['features'])} feature(s) of the plan as a single context-budgeted unit.

## Features

{feature_summary}

## Acceptance

{acceptance_lines}

## Token Estimate

~{group['tokens']:,} tokens (profile: {profile_name})

## Resume Prompt

```
{resume_prompt}
```
"""
