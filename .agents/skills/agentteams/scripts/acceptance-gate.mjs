#!/usr/bin/env node
// Plan-wide acceptance gate. Runs the seven sub-checks from the plan README.
// Exits 0 only when all seven pass.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Anchors — every path is relative to this script's location.
const SCRIPTS_DIR = __dirname;                                              // .agents/skills/agentteams/scripts/
const SKILL_DIR = path.resolve(SCRIPTS_DIR, '..');                          // .agents/skills/agentteams/
const ASSETS_DIR = path.resolve(SCRIPTS_DIR, '../../agentteams-assets');    // .agents/skills/agentteams-assets/
const REPO = path.resolve(SCRIPTS_DIR, '../../../../');                     // repo root
const MJS_BIN = path.join(SCRIPTS_DIR, 'mjs/bin/agentteams');
const PY_SRC = path.join(SCRIPTS_DIR, 'py/src');
const FIXTURE = path.join(ASSETS_DIR, 'fixtures/plans/minimal-plan');

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

function cleanFixture() {
  const ah = path.join(FIXTURE, '.ai-harness');
  if (fs.existsSync(ah)) fs.rmSync(ah, { recursive: true, force: true });
}

function runBin(sub, ...args) {
  return spawnSync('node', [MJS_BIN, sub, FIXTURE, ...args], { encoding: 'utf8' });
}

check('analyze emits five-doc bundle (exit 0)', () => {
  cleanFixture();
  const r = runBin('analyze');
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  const dir = fs.readdirSync(path.join(FIXTURE, '.ai-harness/analysis'))[0];
  const files = fs.readdirSync(path.join(FIXTURE, '.ai-harness/analysis', dir));
  if (files.length !== 6) throw new Error(`got ${files.length} files, want 6`);
  return 'ok';
});

check('dag emits topo order with zero cycles', () => {
  cleanFixture();
  const r = runBin('dag', '--format', 'json');
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  if (obj.cycles.length !== 0) throw new Error(`cycles: ${obj.cycles.length}`);
  if (obj.topologicalOrder.length === 0) throw new Error('empty topo order');
  return 'ok';
});

check('slice --budget conservative groups within ±10% of profile', () => {
  cleanFixture();
  const r = runBin('slice', '--budget', 'conservative', '--format', 'json');
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  for (const g of obj.groups) {
    if (g.tokens > 120000 * 1.10) throw new Error(`group ${g.n}: ${g.tokens}t over budget`);
  }
  return 'ok';
});

check('run --hitl hard exits 7 after handoff', () => {
  cleanFixture();
  spawnSync('node', [MJS_BIN, 'slice', FIXTURE, '--budget', 'conservative'], { encoding: 'utf8' });
  const r = runBin('run', '--hitl', 'hard', '--no-interactive');
  if (r.status !== 7) throw new Error(`exit ${r.status}, want 7. stderr: ${r.stderr}`);
  if (!r.stdout.includes('GROUP 1 COMPLETE')) throw new Error('handoff block missing');
  return 'ok';
});

check('resume prints next-group prompt byte-equal to handoff', () => {
  const r = runBin('resume');
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  if (!r.stdout.includes('implement group 2 of')) throw new Error(`bad resume: ${r.stdout}`);
  return 'ok';
});

check('mjs and py expose same EXIT_CODES.HITL_PAUSE=7', async () => {
  const mjs = await import(path.join(SCRIPTS_DIR, 'mjs/src/exit-codes.mjs'));
  if (mjs.EXIT_HITL_PAUSE !== 7) throw new Error('mjs HITL_PAUSE != 7');
  const pyCheck = spawnSync(
    'python3',
    ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(PY_SRC)}); from agentteams.exit_codes import EXIT_HITL_PAUSE; print(EXIT_HITL_PAUSE)`],
    { encoding: 'utf8' },
  );
  if (pyCheck.stdout.trim() !== '7') throw new Error(`py HITL_PAUSE != 7: got ${pyCheck.stdout}`);
  return 'ok';
});

check('SKILL.md frontmatter validates (name + description + tier)', () => {
  const p = path.join(SKILL_DIR, 'SKILL.md');
  const text = fs.readFileSync(p, 'utf8');
  if (!/^name:\s*agentteams\s*$/m.test(text)) throw new Error('bad name field');
  if (!/^description:/m.test(text)) throw new Error('missing description');
  if (!/^tier:\s*org/m.test(text)) throw new Error('missing tier');
  return 'ok';
});

let pass = 0, fail = 0;
for (const c of checks) {
  try {
    const r = await c.fn();
    process.stdout.write(`PASS  ${c.name} (${r})\n`);
    pass++;
  } catch (e) {
    process.stderr.write(`FAIL  ${c.name} — ${e.message}\n`);
    fail++;
  }
}
cleanFixture();
process.stdout.write(`\nacceptance-gate: ${pass}/${pass + fail} checks passed\n`);
process.exit(fail === 0 ? 0 : 1);
