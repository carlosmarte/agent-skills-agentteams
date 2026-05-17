import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePlan, buildDag, topoSort, prioritize,
  BUDGET_PROFILES, packGroups, writeBundle,
  renderHandoff, defaultState, EXIT_CODES,
} from '../src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../../../agentteams-assets/fixtures/plans/minimal-plan');

test('exit-codes matrix has all nine codes', () => {
  assert.equal(EXIT_CODES.SUCCESS, 0);
  assert.equal(EXIT_CODES.HITL_PAUSE, 7);
  assert.equal(EXIT_CODES.GATE_FAILED, 8);
  assert.equal(EXIT_CODES.NOT_IMPLEMENTED, 100);
});

test('budget profiles match reference transcript', () => {
  assert.equal(BUDGET_PROFILES.conservative.maxTokens, 120000);
  assert.equal(BUDGET_PROFILES.comfortable.maxTokens, 180000);
  assert.equal(BUDGET_PROFILES.aggressive.maxTokens, 250000);
});

test('parsePlan reads minimal fixture', () => {
  const plan = parsePlan(FIXTURE);
  assert.ok(plan.features.length >= 1, 'at least one feature');
  assert.equal(plan.features[0].stories.length >= 1, true);
});

test('buildDag + topoSort produce zero cycles on minimal fixture', () => {
  const plan = parsePlan(FIXTURE);
  const dag = buildDag(plan);
  const { order, cycles } = topoSort(dag);
  assert.equal(cycles.length, 0);
  assert.equal(order.length, dag.nodes.length);
});

test('prioritize assigns tier to every node', () => {
  const plan = parsePlan(FIXTURE);
  const dag = buildDag(plan);
  const sorted = topoSort(dag);
  const prio = prioritize(dag, sorted);
  for (const p of prio) {
    assert.ok(['P0', 'P1', 'P2'].includes(p.tier));
  }
});

test('packGroups fits minimal plan under conservative budget', () => {
  const plan = parsePlan(FIXTURE);
  const groups = packGroups(plan, 'conservative');
  assert.ok(groups.length >= 1);
  for (const g of groups) {
    assert.ok(g.tokens <= BUDGET_PROFILES.conservative.maxTokens * 1.10);
  }
});

test('writeBundle emits six markdown files', async () => {
  const plan = parsePlan(FIXTURE);
  const { dir, files } = writeBundle(plan, FIXTURE);
  assert.equal(files.length, 6);
  const expected = ['README.md', 'fit-matrix.md', 'analysis.md', 'gaps-p0-p1-p2.md', 'schema-deltas.md', 'state-flow.md'];
  for (const e of expected) assert.ok(files.includes(e), `missing ${e}`);
});

test('renderHandoff matches reference-transcript shape', () => {
  const out = renderHandoff({
    n: 1, groupTitle: 'Schema Foundation', landed: [{ id: 'F01', description: 'scaffold', testStatus: 'green', fileCount: 3, files: ['a', 'b', 'c'] }],
    testsLine: '3/3 green. Smoke covered.', acceptanceLine: 'PASS',
    nextN: 2, nextTitle: 'Analyzer', planDir: '/tmp/plan',
  });
  assert.ok(out.includes('GROUP 1 COMPLETE'));
  assert.ok(out.includes('To resume:'));
  assert.ok(out.includes('implement group 2 of /tmp/plan'));
});

test('defaultState exposes schemaVersion=1', () => {
  const s = defaultState();
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.currentGroup, 1);
});
