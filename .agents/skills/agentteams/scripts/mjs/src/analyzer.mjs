// Plan analyzer: five-document bundle writer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EXPECTATIONS = [
  'schema-present',
  'tests-present',
  'acceptance-gate-defined',
  'dependencies-declared',
  'examples-present',
];

function loadExpectations(planDir) {
  const cfg = path.join(planDir, '.agentteams', 'expectations.yaml');
  if (!fs.existsSync(cfg)) return DEFAULT_EXPECTATIONS;
  const text = fs.readFileSync(cfg, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (m) out.push(m[1]);
  }
  return out.length ? out : DEFAULT_EXPECTATIONS;
}

function checkExpectation(name, plan) {
  const surfaces = [];
  for (const f of plan.features) {
    let status = '❌';
    const evidence = [];
    const hay = (f.acceptanceCriteria.join('\n') + ' ' + f.stories.flatMap(s => s.acceptanceCriteria).join('\n')).toLowerCase();
    if (name === 'schema-present' && /schema|ast|frontmatter|matrix|json/.test(hay)) status = '✅';
    else if (name === 'tests-present' && /test|parity|gate|verify/.test(hay)) status = '✅';
    else if (name === 'acceptance-gate-defined' && /acceptance|gate|exit 0|exit 7|byte-equal/.test(hay)) status = '✅';
    else if (name === 'dependencies-declared' && f.stories.some(s => s.dependencies.length > 0)) status = '✅';
    else if (name === 'examples-present' && /example|fixture|golden|replay/.test(hay)) status = '✅';
    if (status === '❌' && /partial|stub|placeholder/.test(hay)) status = '🟡';
    evidence.push(`${f.path}:1`);
    surfaces.push({ featureId: f.id, slug: f.slug, status, evidence });
  }
  return surfaces;
}

export function buildFitMatrix(plan, expectations = DEFAULT_EXPECTATIONS) {
  const matrix = {};
  for (const name of expectations) matrix[name] = checkExpectation(name, plan);
  return matrix;
}

export function renderFitMatrix(matrix, plan) {
  const expectations = Object.keys(matrix);
  const features = plan.features;
  let out = '# Fit Matrix\n\n| Expectation | ' + features.map(f => `F${f.id}`).join(' | ') + ' |\n';
  out += '| ---: | ' + features.map(() => ':---:').join(' | ') + ' |\n';
  for (const exp of expectations) {
    const cells = matrix[exp].map(s => s.status);
    out += `| ${exp} | ${cells.join(' | ')} |\n`;
  }
  out += '\n## Evidence\n\n';
  for (const exp of expectations) {
    out += `\n### ${exp}\n\n`;
    for (const surface of matrix[exp]) {
      out += `- F${surface.featureId} (${surface.slug}): ${surface.status} — ${surface.evidence.join(', ')}\n`;
    }
  }
  return out;
}

export function renderAnalysis(plan) {
  let out = '# Analysis\n\n';
  out += `Plan: \`${plan.planDir}\`\n\n`;
  for (const f of plan.features) {
    out += `## F${f.id} — ${f.slug}\n\n`;
    out += `Path: \`${f.path}\`\n\n`;
    out += `Stories: ${f.stories.length} | Acceptance criteria: ${f.acceptanceCriteria.length}\n\n`;
    if (f.acceptanceCriteria.length > 0) {
      out += 'Acceptance criteria:\n';
      for (const ac of f.acceptanceCriteria) out += `- ${ac}\n`;
      out += '\n';
    }
  }
  return out;
}

export function renderStateFlow(plan) {
  let out = '# State Flow Audit\n\n';
  const machines = [];
  const re = /([a-z][a-z_-]*\s*(?:→|->)\s*[a-z][a-z_ →\->]*)/gi;
  for (const f of plan.features) {
    let m;
    re.lastIndex = 0;
    const body = (f.acceptanceCriteria.join('\n') + '\n' + f.stories.flatMap(s => s.acceptanceCriteria).join('\n'));
    while ((m = re.exec(body)) !== null) {
      machines.push({ feature: `F${f.id}`, transition: m[1] });
    }
  }
  if (machines.length === 0) {
    out += '_No state-machine transitions detected in plan acceptance criteria._\n';
  } else {
    for (const m of machines) out += `- ${m.feature}: \`${m.transition}\`\n`;
  }
  return out;
}

export function renderSchemaDeltas(plan) {
  let out = '# Schema Deltas\n\n';
  out += '_Schema additions surfaced by gap analysis. Populated by F03 prioritizer._\n\n';
  out += '## Detected schema surfaces\n\n';
  let any = false;
  for (const f of plan.features) {
    const hay = (f.acceptanceCriteria.join('\n') + ' ' + f.stories.flatMap(s => s.acceptanceCriteria).join(' '));
    const schemaHints = (hay.match(/(schema|interface|type|AST|frontmatter)/gi) || []).length;
    if (schemaHints > 0) {
      out += `- **F${f.id}** (${f.slug}): ${schemaHints} schema mentions in acceptance criteria.\n`;
      any = true;
    }
  }
  if (!any) out += '_No explicit schema deltas detected._\n';
  return out;
}

export function renderGapsScaffold(plan) {
  // F02 scaffolds; F03 fills the punch-list.
  return `# Gaps — P0 / P1 / P2

_Scaffold emitted by F02 (analyzer). Populated by F03 (DAG prioritizer)._

## Punch list (placeholder)

Run \`agentteams dag <plan-dir>\` to populate.
`;
}

export function renderReadme(plan, bundleDir) {
  const featureCount = plan.features.length;
  const storyCount = plan.features.reduce((a, f) => a + f.stories.length, 0);
  const taskCount = plan.features.reduce((a, f) => a + f.stories.reduce((b, s) => b + s.tasks.length, 0), 0);
  const warnings = plan.warnings.length;
  return `# Analysis bundle — \`${plan.planDir}\`

## Headline verdict

This plan declares **${featureCount} features**, **${storyCount} stories**, and **${taskCount} tasks**, with **${warnings} parser warnings**. Fit-matrix and gap punch list below.

## Files in this bundle

- \`README.md\` — this file (entry index + headline).
- \`fit-matrix.md\` — expectation × surface scoreboard.
- \`analysis.md\` — long-form per-feature walk-through.
- \`gaps-p0-p1-p2.md\` — prioritized punch list (populated by \`agentteams dag\`).
- \`schema-deltas.md\` — schema additions surfaced by analysis.
- \`state-flow.md\` — state-machine audit.
`;
}

export function writeBundle(plan, outRoot) {
  const uuid = crypto.randomUUID();
  const dir = path.join(outRoot, '.ai-harness', 'analysis', uuid);
  fs.mkdirSync(dir, { recursive: true });
  const expectations = loadExpectations(plan.planDir);
  const matrix = buildFitMatrix(plan, expectations);

  const files = {
    'README.md': renderReadme(plan, dir),
    'fit-matrix.md': renderFitMatrix(matrix, plan),
    'analysis.md': renderAnalysis(plan),
    'gaps-p0-p1-p2.md': renderGapsScaffold(plan),
    'schema-deltas.md': renderSchemaDeltas(plan),
    'state-flow.md': renderStateFlow(plan),
  };
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
  return { uuid, dir, files: Object.keys(files), matrix };
}
