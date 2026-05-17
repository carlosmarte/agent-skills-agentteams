# SDK examples

The same full cycle, driven via library imports — proves the public API surface is usable without the CLI.

## Node ESM (`agentteams-mjs`)

```mjs
import {
  parsePlan, buildDag, topoSort, prioritize,
  packGroups, writeBundle,
  defaultState, readState, writeState, renderHandoff,
  BUDGET_PROFILES, EXIT_HITL_PAUSE,
} from 'agentteams-mjs';

const planDir = './.agents/skills/agentteams-assets/fixtures/plans/minimal-plan';
const plan = parsePlan(planDir);
const dag = buildDag(plan);
const { order, cycles } = topoSort(dag);
const prio = prioritize(dag, { order, cycles });
const groups = packGroups(plan, 'conservative');
const { dir, files } = writeBundle(plan, planDir);
console.log({ groupsCount: groups.length, bundleDir: dir, files });
```

## Python (`agentteams`)

```py
from agentteams import (
    parse_plan, build_dag, topo_sort, prioritize,
    pack_groups, write_bundle,
    default_state, read_state, write_state, render_handoff,
    BUDGET_PROFILES, EXIT_HITL_PAUSE,
)

plan_dir = "./.agents/skills/agentteams-assets/fixtures/plans/minimal-plan"
plan = parse_plan(plan_dir)
dag = build_dag(plan)
sorted_ = topo_sort(dag)
prio = prioritize(dag, sorted_)
groups = pack_groups(plan, "conservative")
result = write_bundle(plan, plan_dir)
print({"groupsCount": len(groups), "bundleDir": result["dir"], "files": result["files"]})
```

Both surfaces are functionally identical and emit byte-equal JSON via `--format json`.
