# CLI examples

End-to-end CLI scenarios that replay the canonical reference-transcript flow against the bundled fixture plan.

## Full-cycle scenario

All paths are relative to the repo root.

```sh
# Convenient shell var so commands stay short
PLAN=.agents/skills/agentteams-assets/fixtures/plans/minimal-plan

# 1. Analyze — emit five-doc bundle
node .agents/skills/agentteams/scripts/mjs/bin/agentteams analyze "$PLAN"

# 2. Build dependency DAG — JSON to stdout
node .agents/skills/agentteams/scripts/mjs/bin/agentteams dag "$PLAN" --format json

# 3. Slice into token-budgeted groups
node .agents/skills/agentteams/scripts/mjs/bin/agentteams slice "$PLAN" --budget conservative

# 4. Execute group 1 — emits handoff, exits 7 (HITL_PAUSE) in hard mode
node .agents/skills/agentteams/scripts/mjs/bin/agentteams run "$PLAN" --hitl hard --no-interactive
echo "exit code: $?"   # expect: 7

# 5. Resume — prints the prompt to paste after /clear
node .agents/skills/agentteams/scripts/mjs/bin/agentteams resume "$PLAN"

# 6. Reprint the last handoff block
node .agents/skills/agentteams/scripts/mjs/bin/agentteams report "$PLAN"
```

## Python twin (identical surface)

```sh
cd .agents/skills/agentteams/scripts/py
uv sync                  # one-time
PLAN=../../../../agentteams-assets/fixtures/plans/minimal-plan
uv run agentteams analyze "$PLAN"
uv run agentteams dag    "$PLAN" --format json
uv run agentteams slice  "$PLAN" --budget conservative
uv run agentteams run    "$PLAN" --hitl hard --no-interactive
uv run agentteams resume "$PLAN"
```

The two runtimes are parity-tested: byte-equal JSON output across `analyze`, `dag`, `slice` for every example. Run `make parity` from the repo root.
