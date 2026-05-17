# API surface — one file per public surface

The public contract of `agentteams-mjs` and `agentteams` (py). Future versions promise to keep these stable; a breaking change here triggers a major-version bump.

## Surfaces

| Surface  | Import                                | Behavior |
| -------- | ------------------------------------- | --- |
| Parser   | `parsePlan` / `parse_plan`            | Walks `<plan-dir>/features/`, `stories/`, `tasks/`; emits typed AST. |
| DAG      | `buildDag`, `topoSort` / `topo_sort`  | Builds dependency DAG; Kahn's algorithm; cycle reporting. |
| Priority | `prioritize`                          | Assigns P0/P1/P2 per node; transitive blocker count + risk hints. |
| Slicer   | `packGroups` / `pack_groups`          | Greedy topological packing under a budget profile; split-at-story fallback. |
| Analyzer | `writeBundle` / `write_bundle`        | Atomically writes the six-document bundle to `<plan-dir>/.ai-harness/analysis/<uuid>/`. |
| Runner   | `renderHandoff` / `render_handoff`    | Slot-fills the canonical handoff template. |
| State    | `readState`, `writeState`             | Atomic state.json IO with `schemaVersion: 1`. |
| Exit codes | `EXIT_CODES`                        | Frozen matrix (0 success / 7 hitl-pause / 8 gate-failed / 100 not-implemented / ...). |

## Type signatures

### Parser

- `parsePlan(planDir: string) -> Plan`
- `Plan = { planDir, readme, features: Feature[], warnings }`
- `Feature = { id, slug, path, acceptanceCriteria, stories: Story[] }`
- `Story = { id, slug, path, featureId, acceptanceCriteria, dependencies, context, tasks: Task[] }`
- `Task = { id, slug, path, targetFiles, verification, context, changes }`

### DAG

- `buildDag(plan, { implicit?: true }) -> { nodes, edges, nodeMap }`
- `topoSort(dag) -> { order: string[], cycles: string[][] }`
- `prioritize(dag, topo) -> Array<{ id, tier: 'P0'|'P1'|'P2', blockersDownstream, risk }>`

### Slicer

- `BUDGET_PROFILES = { conservative: 120k, comfortable: 180k, aggressive: 250k }`
- `estimateTask(task) -> number` (tokens)
- `estimateStory(story) -> number`
- `estimateFeature(feature) -> number`
- `packGroups(plan, profile) -> Group[]` — throws `BUDGET_EXCEEDED` if any single story alone exceeds budget.
- `renderGroup(group, plan, planDir, profile) -> string` — markdown body for `groups/NN-<slug>.md`.

### Analyzer

- `buildFitMatrix(plan, expectations?) -> Record<string, Surface[]>`
- `renderFitMatrix(matrix, plan) -> string`
- `renderAnalysis(plan) -> string`
- `renderStateFlow(plan) -> string`
- `renderSchemaDeltas(plan) -> string`
- `renderGapsScaffold(plan) -> string`
- `renderReadme(plan, bundleDir) -> string`
- `writeBundle(plan, outRoot) -> { uuid, dir, files, matrix }` — atomic six-file write.

### Runner

- `HITL_MODES = ['hard', 'soft', 'phase-only']`
- `TESTING_MODES = ['tests+gate', 'implement-only', 'granular']`
- `defaultState() -> State`
- `readState(planDir) -> State | null` — refuses stale `schemaVersion`.
- `writeState(planDir, state) -> State` — atomic tmp + rename.
- `renderHandoff({ n, groupTitle, landed, testsLine, acceptanceLine, nextN, nextTitle, planDir, sessionPlanPath? }) -> string`
- `writeHandoff(planDir, n, body) -> string` (path written).
- `describeMenu() -> { q1, q2, q3 }`
- `harvestLandedFromGit(planDir, sinceRef?) -> Landed[]`
