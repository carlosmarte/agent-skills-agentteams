# AgentTeams

Orchestrator skill + Claude Code agent wrapper + polyglot runnable libraries (`mjs` + `py`) that drive a plan tree (`features/`, `stories/`, `tasks/`) through six executable phases: **analyze → dag → slice → run → report → resume**.

The skill consumes plans authored by the upstream `plan-feature-story-task` skill and emits the canonical **handoff block** (Landed / Tested / Acceptance / Next / To Resume) at every group boundary, so an executor can `/clear` between groups without losing state.

## Layout

```
agent-skills-agentteams/
├── .agents/
│   ├── claude/agentteams.md                                   # Claude Code agent wrapper
│   └── skills/
│       ├── agentteams/                                        # the orchestrator skill
│       │   ├── SKILL.md                                       # agentskills.io-conformant manifest
│       │   └── scripts/                                       # implementation lives here
│       │       ├── mjs/                                       # Node ESM runtime (primary)
│       │       │   ├── bin/agentteams                         # CLI shebang
│       │       │   ├── src/{cli,parser,dag,slicer,analyzer,runner,index,exit-codes}.mjs
│       │       │   └── test/smoke.test.mjs
│       │       ├── py/                                        # Python twin (parity-tested)
│       │       │   ├── src/agentteams/{cli,parser,dag,slicer,analyzer,runner,__init__,exit_codes}.py
│       │       │   └── tests/test_smoke.py
│       │       ├── parity.mjs                                 # mjs ↔ py byte-equal JSON harness
│       │       ├── acceptance-gate.mjs                        # seven-check plan-wide gate
│       │       ├── resolve-target.mjs / resolve_target.py     # target-path precedence helpers
│       └── agentteams-assets/                                 # static assets skill
│           ├── SKILL.md                                       # asset-skill manifest
│           ├── fixtures/plans/minimal-plan/                   # hand-authored 1F/1S/1T plan
│           └── examples/{cli,sdk,api}/                        # runnable scenarios + API contract
├── Makefile                                                   # root orchestrator (delegates into skill scripts)
└── .github/workflows/ci.yml                                   # CI workflow
```

## CLI

```sh
agentteams analyze <plan-dir>                  # five-doc bundle
agentteams dag     <plan-dir>                  # topo-sorted DAG (JSON or DOT)
agentteams slice   <plan-dir> --budget P       # write groups/NN-<slug>.md
agentteams run     <plan-dir> [--group N]      # emit handoff; exit 7 in HITL hard
agentteams report  <plan-dir>                  # reprint last handoff
agentteams resume  <plan-dir>                  # print next-group prompt
```

Profiles: `conservative` (~120k), `comfortable` (~180k), `aggressive` (~250k).

HITL: `hard` (default, recommended), `soft`, `phase-only`.

Exit codes: `0` success | `1` generic | `2` misuse | `3` plan-not-found | `4` parse-error | `5` cycle-detected | `6` budget-exceeded | `7` hitl-pause | `8` gate-failed | `100` not-implemented.

## Install (`agentteams` on $PATH)

The CLI ships as a bin in `.agents/skills/agentteams/scripts/mjs/package.json` but is not auto-installed globally. Add this to `~/.zshrc` (or `~/.bashrc`) to expose it portably:

```sh
export AGENTTEAMS_HOME="${HOME}/<path-to-this-checkout>"
alias agentteams='node "$AGENTTEAMS_HOME/.agents/skills/agentteams/scripts/mjs/bin/agentteams"'
```

Without the alias, invoke via `node .agents/skills/agentteams/scripts/mjs/bin/agentteams …` (from the repo root) or `uv run agentteams …` (inside `.agents/skills/agentteams/scripts/py/`). The root `Makefile` exposes shorter targets — `make analyze | dag | slice | run | report | resume | parity | gate`.

## Quick start

```sh
make install
make test
make parity
make gate

# Drive the bundled fixture plan end-to-end
make analyze
make slice
make run         # exits 7 with handoff block on stdout
make resume      # prints the prompt to paste after /clear
```

## Acceptance gate

`scripts/acceptance-gate.mjs` runs seven binary sub-checks:

1. `analyze` emits the five-doc bundle and exits 0.
2. `dag` emits zero cycles + a non-empty topological order.
3. `slice --budget conservative` keeps every group within ±10% of profile.
4. `run --hitl hard` exits 7 after emitting the handoff block.
5. `resume` prints a prompt byte-equal to the last handoff's "To resume" line.
6. mjs and py both expose `EXIT_HITL_PAUSE = 7`.
7. `SKILL.md` frontmatter has `name`, `description`, and `tier: org`.

### Manage installed skills

```sh
npx skills add carlosmarte/agent-skills-agentteams
npx skills add carlosmarte/agent-skills-agentteams --list                  # list skills in this repo
npx skills add carlosmarte/agent-skills-agentteams --skill agentteams      # install one skill
npx skills list                                       # show what's installed
npx skills update agentteams                          # pull latest version of one skill
npx skills update -g                                  # update all global skills
npx skills remove agentteams-assets                   # uninstall one
```

Full CLI reference: [vercel-labs/skills](https://github.com/vercel-labs/skills).

## Alternative: one-shot install via curl

If you'd rather clone the whole repo once and symlink every skill into `~/.claude/skills/`
(no per-skill picking, no Node required on the install path), use the bundled installer:

```sh
curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash
```

```sh
wget -qO- https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash
```

The installer clones the repo into `~/.agent-skills-agentteams` and creates one symlink per
skill in `~/.claude/skills/<name>` (today: `agentteams` and `agentteams-assets`). Re-running
fast-forwards the checkout and refreshes the symlinks — it is fully idempotent.

Pass flags after `-s --` to customize:

```sh
# install + run the acceptance gate over the linked skills immediately
curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash -s -- --run

# install to a different checkout location
curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash -s -- --prefix="$HOME/code/agent-skills-agentteams"

# pin to a specific tag / branch / commit
curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash -s -- --ref=v0.1.0

# point the symlinks at a non-default loader directory
curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash -s -- --link-dir="$HOME/.config/agents/skills"
```

Equivalent env vars: `AGENTTEAMS_KIT_HOME`, `AGENTTEAMS_KIT_REF`,
`AGENTTEAMS_KIT_LINK_DIR`, `AGENTTEAMS_KIT_RUN=1`, `AGENTTEAMS_KIT_REPO`.

Inspect state at any time with `bash install.sh --status` (from a local checkout). After
install, set up the mjs + py runtimes by running `make install && make ci` inside the
checkout — see [Quick start](#quick-start) above.

## Plan that produced this code

See `../AI-Agent-Plans/20/agentteams-05172026/` (6 features, 21 stories, 76 tasks).

## License

Inherited from the parent repo.
