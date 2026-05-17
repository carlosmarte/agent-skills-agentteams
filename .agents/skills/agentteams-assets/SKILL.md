---
name: agentteams-assets
description: Static assets for the AgentTeams orchestrator — bundled fixture plans (minimal, multi-feature), CLI/SDK/API example scenarios, and golden files used by the parity harness and acceptance gate. Read-only from the perspective of the org-agentteams skill; consumers reference these via relative paths from packages, scripts, and tests.
tier: org
dependencies:
  - agentteams
---

# AgentTeams Assets

Co-located assets for the [`agentteams`](../agentteams/SKILL.md) skill. Kept under the skills tree so they ship with the skill, not as a sibling that could drift.

## Layout

```
.agents/skills/agentteams-assets/
├── fixtures/
│   └── plans/
│       └── minimal-plan/          # 1F / 1S / 1T hand-authored fixture
│           ├── README.md
│           ├── features/01-schema.md
│           ├── stories/01/01-schema.md
│           └── tasks/01/01/01-declare.md
└── examples/
    ├── README.md
    ├── cli/README.md              # full-cycle CLI scenarios (analyze → resume)
    ├── sdk/README.md              # library-import scenarios (mjs + py)
    └── api/README.md              # type signatures + per-surface behavior
```

## Reference paths (consumers hop across the skills tree via `../../agentteams-assets/`)

| Consumer | Asset | Resolution |
| --- | --- | --- |
| `…/agentteams/scripts/mjs/test/smoke.test.mjs` | minimal-plan | `path.resolve(__dirname, '../../../../agentteams-assets/fixtures/plans/minimal-plan')` |
| `…/agentteams/scripts/py/tests/test_smoke.py` | minimal-plan | `Path(__file__).resolve().parents[4] / 'agentteams-assets' / 'fixtures' / 'plans' / 'minimal-plan'` |
| `…/agentteams/scripts/parity.mjs` | minimal-plan | `path.join(SCRIPTS_DIR, '../../agentteams-assets/fixtures/plans/minimal-plan')` |
| `…/agentteams/scripts/acceptance-gate.mjs` | minimal-plan | same (uses the shared `ASSETS_DIR` constant) |
| Root `Makefile` | `PLAN` default | `.agents/skills/agentteams-assets/fixtures/plans/minimal-plan` |

All consumers anchor on `__dirname` / `__file__` ascent — never on the repo root or an absolute host path. The asset skill is a peer of the orchestrator skill, so the cross-skill hop is always `../../agentteams-assets/…` from the orchestrator's `scripts/` dir.

All consumers anchor on the repo root via `git rev-parse --show-toplevel` semantics (Makefile / scripts) or `__dirname` / `__file__` ascent (tests). No absolute host paths.

## Adding a new fixture

1. Author `<name>-plan/` under `fixtures/plans/` following the `features/stories/tasks` 3-tier shape.
2. Drop a `README.md` at the fixture root listing scope + execution order.
3. Reference from a new test via the same relative-path pattern above — never hard-code an absolute path.

## Adding a new example

1. Pick a surface — `cli/`, `sdk/`, or `api/`.
2. Add a `README.md` (or `NN-<scenario>.md`) that exercises one or more of the six subcommands.
3. If the example needs a fresh fixture, add it to `fixtures/plans/` first.
