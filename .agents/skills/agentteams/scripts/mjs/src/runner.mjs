// Orchestrator loop: HITL prompts, testing gates, state persistence, handoff renderer, resume.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const HITL_MODES = ['hard', 'soft', 'phase-only'];
export const TESTING_MODES = ['tests+gate', 'implement-only', 'granular'];
export const STATE_SCHEMA_VERSION = 1;

export function stateFilePath(planDir) {
  return path.join(planDir, '.ai-harness', 'state.json');
}

export function readState(planDir) {
  const p = stateFilePath(planDir);
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (raw.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw Object.assign(new Error(`stale-state-schema: got ${raw.schemaVersion}, want ${STATE_SCHEMA_VERSION}`), { code: 'PARSE_ERROR' });
  }
  return raw;
}

export function writeState(planDir, state) {
  const p = stateFilePath(planDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const merged = {
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    ...state,
  };
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  return merged;
}

export function defaultState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    currentGroup: 1,
    lastCompletedGroup: 0,
    hitlMode: 'hard',
    budgetProfile: 'conservative',
    testingMode: 'tests+gate',
    phaseAcceptanceGates: {},
  };
}

export function renderHandoff({ n, groupTitle, landed, testsLine, acceptanceLine, nextN, nextTitle, planDir, sessionPlanPath }) {
  const landedBlock = landed.map(l => `- ${l.id}: ${l.description} — tests ${l.testStatus}, ${l.fileCount} files\n  • ${(l.files || []).join('\n  • ')}`).join('\n');
  const sessionRef = sessionPlanPath || `${planDir}/.ai-harness/session-plan.md`;
  return `GROUP ${n} COMPLETE — ${groupTitle}

Landed: ${landedBlock || '(no landed items recorded)'}

Tests: ${testsLine}

Acceptance: ${acceptanceLine}

Next: GROUP ${nextN} — ${nextTitle}

To resume: 1) Run /clear to drop this session's context. 2) Paste this prompt:

       implement group ${nextN} of ${planDir} per ${sessionRef}
`;
}

export function writeHandoff(planDir, n, body) {
  const dir = path.join(planDir, '.ai-harness', 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${n}.md`);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

export function describeMenu() {
  return {
    q1: {
      header: 'Token budget',
      question: 'Target token budget per group',
      options: [
        { label: 'Conservative ~120k (Recommended)', value: 'conservative' },
        { label: 'Comfortable ~180k', value: 'comfortable' },
        { label: 'Aggressive ~250k', value: 'aggressive' },
      ],
    },
    q2: {
      header: 'HITL pause',
      question: 'How should I pause between groups',
      options: [
        { label: 'Hard stop with re-entry prompt (Recommended)', value: 'hard' },
        { label: 'Soft stop — wait for confirmation', value: 'soft' },
        { label: 'Only pause at phase boundaries', value: 'phase-only' },
      ],
    },
    q3: {
      header: 'Acceptance',
      question: 'Should each group end with acceptance-gate verification',
      options: [
        { label: 'Run tests + acceptance gate when one fits (Recommended)', value: 'tests+gate' },
        { label: 'Implement only, defer testing', value: 'implement-only' },
        { label: 'Tests after every feature, gate after every phase', value: 'granular' },
      ],
    },
  };
}

export function harvestLandedFromGit(planDir, sinceRef = 'HEAD~1') {
  // Lightweight harvest stub — in CI, replaced by real git diff parsing.
  return [{
    id: 'F?',
    description: 'group landed (git harvest stub)',
    testStatus: 'green',
    fileCount: 0,
    files: [],
  }];
}
