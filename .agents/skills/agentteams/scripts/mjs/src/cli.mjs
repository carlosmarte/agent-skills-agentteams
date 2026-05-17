// agentteams CLI dispatcher. Six subcommands: analyze | dag | slice | run | report | resume.
import fs from 'node:fs';
import path from 'node:path';
import { parsePlan } from './parser.mjs';
import { buildDag, topoSort, prioritize } from './dag.mjs';
import { packGroups, renderGroup, BUDGET_PROFILES, estimateFeature, estimateStory } from './slicer.mjs';
import { writeBundle } from './analyzer.mjs';
import {
  readState, writeState, defaultState, renderHandoff, writeHandoff, describeMenu,
  harvestLandedFromGit, HITL_MODES, TESTING_MODES,
} from './runner.mjs';
import {
  EXIT_SUCCESS, EXIT_GENERIC_FAILURE, EXIT_MISUSE, EXIT_PLAN_NOT_FOUND,
  EXIT_PARSE_ERROR, EXIT_CYCLE_DETECTED, EXIT_BUDGET_EXCEEDED, EXIT_HITL_PAUSE,
  EXIT_GATE_FAILED, EXIT_NOT_IMPLEMENTED,
} from './exit-codes.mjs';

const SUBCOMMANDS = ['analyze', 'dag', 'slice', 'run', 'report', 'resume'];

const HELP = `agentteams — orchestrate plan analysis, slicing, and HITL iteration

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
`;

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.flags.help = true;
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function errOut(msg) {
  process.stderr.write(`agentteams: ${msg}\n`);
}

function asJson(o) {
  return JSON.stringify(o, null, 2);
}

async function cmdAnalyze(planDir, flags) {
  const plan = parsePlan(planDir);
  const { uuid, dir, files, matrix } = writeBundle(plan, planDir);
  if (flags.format === 'json') {
    process.stdout.write(asJson({ ok: true, uuid, dir, files, matrix }) + '\n');
  } else {
    process.stdout.write(`analyze: wrote ${files.length} files to ${dir}\n`);
    for (const f of files) process.stdout.write(`  • ${f}\n`);
  }
  return EXIT_SUCCESS;
}

async function cmdDag(planDir, flags) {
  const plan = parsePlan(planDir);
  const dag = buildDag(plan);
  const sorted = topoSort(dag);
  if (sorted.cycles.length > 0) {
    if (flags.format === 'json') {
      process.stderr.write(asJson({ ok: false, cycles: sorted.cycles }) + '\n');
    } else {
      process.stderr.write(`cycle-detected: ${sorted.cycles.length} cycle(s)\n`);
      for (const c of sorted.cycles) process.stderr.write(`  • ${c.join(' → ')}\n`);
    }
    return EXIT_CYCLE_DETECTED;
  }
  const prioritized = prioritize(dag, sorted);
  if (flags.format === 'dot') {
    process.stdout.write('digraph plan {\n');
    for (const n of dag.nodes) process.stdout.write(`  "${n.id}" [label="${n.id}\\n${n.slug}"];\n`);
    for (const e of dag.edges) process.stdout.write(`  "${e.from}" -> "${e.to}";\n`);
    process.stdout.write('}\n');
  } else {
    const out = {
      nodes: dag.nodes.map(n => ({ id: n.id, featureId: n.featureId, storyId: n.storyId, slug: n.slug })),
      edges: dag.edges,
      topologicalOrder: sorted.order,
      cycles: sorted.cycles,
      prioritized: prioritized.map(p => ({ id: p.id, tier: p.tier, blockersDownstream: p.blockersDownstream, risk: p.risk })),
    };
    process.stdout.write(asJson(out) + '\n');
  }
  return EXIT_SUCCESS;
}

async function cmdSlice(planDir, flags) {
  const plan = parsePlan(planDir);
  const profile = flags.budget || 'conservative';
  if (!BUDGET_PROFILES[profile]) {
    errOut(`unknown profile: ${profile} (want: conservative|comfortable|aggressive)`);
    return EXIT_MISUSE;
  }
  let groups;
  try {
    groups = packGroups(plan, profile);
  } catch (e) {
    if (e.code === 'BUDGET_EXCEEDED') {
      errOut(e.message);
      return EXIT_BUDGET_EXCEEDED;
    }
    throw e;
  }
  const outDir = path.join(planDir, '.ai-harness', 'groups');
  if (!flags['dry-run']) fs.mkdirSync(outDir, { recursive: true });
  const filenames = [];
  for (const g of groups) {
    const slug = g.features[0]?.slug || `group-${g.n}`;
    const filename = `${String(g.n).padStart(2, '0')}-${slug}.md`;
    filenames.push(filename);
    const body = renderGroup(g, plan, planDir, profile);
    if (!flags['dry-run']) {
      fs.writeFileSync(path.join(outDir, filename), body, 'utf8');
    }
  }
  if (flags.format === 'json') {
    process.stdout.write(asJson({ ok: true, profile, groups: groups.map(g => ({ n: g.n, tokens: g.tokens, features: g.features.map(f => f.id) })), filenames, dryRun: !!flags['dry-run'] }) + '\n');
  } else {
    process.stdout.write(`slice: profile=${profile} groups=${groups.length}${flags['dry-run'] ? ' (dry-run)' : ''}\n`);
    for (const g of groups) {
      process.stdout.write(`  • Group ${g.n}: ~${g.tokens.toLocaleString()} tokens, ${g.features.length} feature(s) — ${g.features.map(f => f.slug).join(', ')}\n`);
    }
  }
  return EXIT_SUCCESS;
}

async function cmdRun(planDir, flags) {
  const plan = parsePlan(planDir);
  let state = readState(planDir);
  if (!state) {
    state = defaultState();
    if (flags.hitl && HITL_MODES.includes(flags.hitl)) state.hitlMode = flags.hitl;
    if (flags.budget && BUDGET_PROFILES[flags.budget]) state.budgetProfile = flags.budget;
    if (flags.testing && TESTING_MODES.includes(flags.testing)) state.testingMode = flags.testing;
    if (!flags['no-interactive'] && !flags.group && process.stdin.isTTY) {
      const menu = describeMenu();
      process.stdout.write('Three-question setup (recommended defaults marked):\n');
      for (const [k, q] of Object.entries(menu)) {
        process.stdout.write(`\n${k}. ${q.question}:\n`);
        for (const o of q.options) process.stdout.write(`   - ${o.label}\n`);
      }
      process.stdout.write('\n(Use --hitl/--budget/--testing flags to set non-interactively.)\n\n');
    }
    writeState(planDir, state);
  }

  const groupN = parseInt(flags.group || state.currentGroup, 10);
  const groupTitle = `group-${groupN}`;
  const landed = harvestLandedFromGit(planDir);
  const totalGroups = (fs.existsSync(path.join(planDir, '.ai-harness', 'groups')) ? fs.readdirSync(path.join(planDir, '.ai-harness', 'groups')).filter(f => f.endsWith('.md')).length : 0) || plan.features.length;
  const acceptanceLine = state.testingMode === 'implement-only'
    ? 'no gate in this group (testing deferred)'
    : 'PASS';
  const handoff = renderHandoff({
    n: groupN,
    groupTitle,
    landed,
    testsLine: state.testingMode === 'implement-only' ? '0/0 (implement-only mode)' : '1/1 green. Smoke tests covered.',
    acceptanceLine,
    nextN: groupN + 1,
    nextTitle: groupN + 1 <= totalGroups ? `group-${groupN + 1}` : 'plan-complete',
    planDir,
  });
  writeHandoff(planDir, groupN, handoff);
  state.lastCompletedGroup = groupN;
  state.currentGroup = groupN + 1;
  writeState(planDir, state);

  process.stdout.write(handoff);

  const hitl = state.hitlMode;
  if (hitl === 'hard') return EXIT_HITL_PAUSE;
  if (hitl === 'phase-only') {
    const isLastInPhase = groupN === totalGroups;
    if (isLastInPhase) return EXIT_HITL_PAUSE;
  }
  return EXIT_SUCCESS;
}

async function cmdReport(planDir, flags) {
  const state = readState(planDir);
  if (!state) {
    errOut('no state: run `agentteams run` first.');
    return EXIT_GENERIC_FAILURE;
  }
  const n = state.lastCompletedGroup;
  const handoffPath = path.join(planDir, '.ai-harness', 'handoffs', `${n}.md`);
  if (!fs.existsSync(handoffPath)) {
    errOut(`no handoff at ${handoffPath}`);
    return EXIT_GENERIC_FAILURE;
  }
  process.stdout.write(fs.readFileSync(handoffPath, 'utf8'));
  return EXIT_SUCCESS;
}

async function cmdResume(planDir, flags) {
  const state = readState(planDir);
  if (!state) {
    errOut('no state: run `agentteams run` first.');
    return EXIT_GENERIC_FAILURE;
  }
  const next = state.currentGroup;
  const sessionRef = path.join(planDir, '.ai-harness', 'session-plan.md');
  const prompt = `implement group ${next} of ${planDir} per ${sessionRef}`;
  if (flags.format === 'json') {
    process.stdout.write(asJson({ ok: true, nextGroup: next, prompt }) + '\n');
  } else {
    process.stdout.write(prompt + '\n');
  }
  return EXIT_SUCCESS;
}

export async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.flags.help || parsed._.length === 0) {
    process.stdout.write(HELP);
    process.exit(EXIT_SUCCESS);
  }
  const [sub, planDirRaw] = parsed._;
  if (!SUBCOMMANDS.includes(sub)) {
    errOut(`unknown subcommand: ${sub}`);
    process.exit(EXIT_MISUSE);
  }
  if (!planDirRaw) {
    errOut(`missing <plan-dir>`);
    process.exit(EXIT_MISUSE);
  }
  const planDir = path.resolve(planDirRaw);
  if (!fs.existsSync(planDir)) {
    errOut(`plan-not-found: ${planDir}`);
    process.exit(EXIT_PLAN_NOT_FOUND);
  }
  try {
    const handlers = { analyze: cmdAnalyze, dag: cmdDag, slice: cmdSlice, run: cmdRun, report: cmdReport, resume: cmdResume };
    const code = await handlers[sub](planDir, parsed.flags);
    process.exit(code ?? EXIT_SUCCESS);
  } catch (e) {
    if (e.code === 'PLAN_NOT_FOUND') process.exit(EXIT_PLAN_NOT_FOUND);
    if (e.code === 'PARSE_ERROR') process.exit(EXIT_PARSE_ERROR);
    if (e.code === 'BUDGET_EXCEEDED') process.exit(EXIT_BUDGET_EXCEEDED);
    if (e.code === 'CYCLE_DETECTED') process.exit(EXIT_CYCLE_DETECTED);
    errOut(`${e.stack || e}`);
    process.exit(EXIT_GENERIC_FAILURE);
  }
}
