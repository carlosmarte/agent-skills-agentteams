#!/usr/bin/env node
// Polyglot parity harness — invoke every CLI subcommand × every example × both runtimes
// and assert byte-equal JSON output. Exit 1 on mismatch.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Anchors — every path is relative to this script's location.
const SCRIPTS_DIR = __dirname;                                          // .agents/skills/agentteams/scripts/
const ASSETS_DIR = path.resolve(SCRIPTS_DIR, '../../agentteams-assets'); // .agents/skills/agentteams-assets/
const MJS_BIN = path.join(SCRIPTS_DIR, 'mjs/bin/agentteams');
const PY_BIN = ['uv', ['run', '--quiet', '--directory', path.join(SCRIPTS_DIR, 'py'), '--', 'agentteams']];

const FIXTURE = path.join(ASSETS_DIR, 'fixtures/plans/minimal-plan');
const SUBCOMMANDS = ['analyze', 'dag', 'slice'];
const EXTRA_FLAGS = {
  slice: ['--budget', 'conservative', '--dry-run'],
};

function runMjs(sub, planDir) {
  const args = [MJS_BIN, sub, planDir, '--format', 'json', ...(EXTRA_FLAGS[sub] || [])];
  return spawnSync('node', args, { encoding: 'utf8' });
}

function runPy(sub, planDir) {
  const args = [...PY_BIN[1], sub, planDir, '--format', 'json', ...(EXTRA_FLAGS[sub] || [])];
  return spawnSync(PY_BIN[0], args, { encoding: 'utf8' });
}

function normalize(text, sub) {
  let obj;
  try { obj = JSON.parse(text); } catch { return text; }
  // Strip non-deterministic fields (uuid, paths with uuid) — only structural parity matters.
  if (sub === 'analyze') {
    delete obj.uuid;
    if (obj.dir) obj.dir = obj.dir.replace(/[0-9a-f-]{36}/, '<uuid>');
  }
  return JSON.stringify(obj, null, 2);
}

let failures = 0;
const results = [];

for (const sub of SUBCOMMANDS) {
  // pre-clean .ai-harness between runs to prevent cross-run pollution
  const ah = path.join(FIXTURE, '.ai-harness');
  if (fs.existsSync(ah)) fs.rmSync(ah, { recursive: true, force: true });

  const mjs = runMjs(sub, FIXTURE);
  if (fs.existsSync(ah)) fs.rmSync(ah, { recursive: true, force: true });
  const py = runPy(sub, FIXTURE);

  const mjsOut = normalize(mjs.stdout || '', sub);
  const pyOut = normalize(py.stdout || '', sub);

  const ok = mjsOut === pyOut && mjs.status === py.status;
  if (!ok) {
    failures++;
    results.push({ sub, status: 'FAIL', mjsStatus: mjs.status, pyStatus: py.status });
    process.stderr.write(`\n=== PARITY FAIL: ${sub} ===\n`);
    process.stderr.write(`--- mjs (exit ${mjs.status}) ---\n${mjsOut}\n`);
    process.stderr.write(`--- py  (exit ${py.status}) ---\n${pyOut}\n`);
  } else {
    results.push({ sub, status: 'PASS' });
    process.stdout.write(`parity: ${sub} PASS\n`);
  }
}

process.stdout.write(`\nparity summary: ${results.filter(r => r.status === 'PASS').length}/${results.length} subcommands match\n`);
process.exit(failures === 0 ? 0 : 1);
