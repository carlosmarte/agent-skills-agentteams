// Token estimator + budget profiles + greedy topological packer + group renderer.
import fs from 'node:fs';

export const BUDGET_PROFILES = Object.freeze({
  conservative: { maxTokens: 120000, recommendedFeaturesPerGroup: [1, 3] },
  comfortable: { maxTokens: 180000, recommendedFeaturesPerGroup: [2, 4] },
  aggressive: { maxTokens: 250000, recommendedFeaturesPerGroup: [3, 5] },
});

const CHAR_TO_TOKEN = 0.27;
const PLANNING_OVERHEAD = 0.15;
const TOOL_CALL_OVERHEAD = 0.20;

function fileChars(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

export function estimateTask(task) {
  const baseChars = fileChars(task.path);
  let tokens = baseChars * CHAR_TO_TOKEN;
  tokens *= 1 + PLANNING_OVERHEAD;
  const toolCalls = (task.targetFiles || []).length;
  tokens *= 1 + TOOL_CALL_OVERHEAD * toolCalls;
  return Math.round(tokens);
}

export function estimateStory(story) {
  const own = Math.round(fileChars(story.path) * CHAR_TO_TOKEN * (1 + PLANNING_OVERHEAD));
  const tasks = (story.tasks || []).reduce((acc, t) => acc + estimateTask(t), 0);
  return own + tasks;
}

export function estimateFeature(feature) {
  const own = Math.round(fileChars(feature.path) * CHAR_TO_TOKEN * (1 + PLANNING_OVERHEAD));
  const stories = feature.stories.reduce((acc, s) => acc + estimateStory(s), 0);
  return own + stories;
}

export function packGroups(plan, profileName) {
  const profile = BUDGET_PROFILES[profileName];
  if (!profile) {
    throw Object.assign(new Error(`unknown-profile: ${profileName}`), { code: 'MISUSE' });
  }
  const budget = profile.maxTokens;
  const groups = [];
  let current = { features: [], tokens: 0 };
  const tolerance = budget * 1.10;

  for (const feature of plan.features) {
    const fTokens = estimateFeature(feature);
    if (fTokens > tolerance) {
      // Need to split — emit prior, then split-by-story
      if (current.features.length > 0) {
        groups.push(current);
        current = { features: [], tokens: 0 };
      }
      let subFeature = { ...feature, stories: [] };
      let subTokens = 0;
      for (const story of feature.stories) {
        const sTokens = estimateStory(story);
        if (sTokens > tolerance) {
          const err = new Error(`budget-exceeded: story ${feature.id}.${story.id} (~${sTokens}t) > ${budget}t profile`);
          err.code = 'BUDGET_EXCEEDED';
          throw err;
        }
        if (subTokens + sTokens > tolerance) {
          groups.push({ features: [{ ...subFeature, _splitContinuation: true }], tokens: subTokens });
          subFeature = { ...feature, stories: [] };
          subTokens = 0;
        }
        subFeature.stories.push(story);
        subTokens += sTokens;
      }
      if (subFeature.stories.length > 0) {
        groups.push({ features: [subFeature], tokens: subTokens });
      }
      continue;
    }
    if (current.tokens + fTokens > tolerance) {
      groups.push(current);
      current = { features: [], tokens: 0 };
    }
    current.features.push(feature);
    current.tokens += fTokens;
  }
  if (current.features.length > 0) groups.push(current);
  return groups.map((g, i) => ({ ...g, n: i + 1 }));
}

export function renderGroup(group, plan, planDir, profileName) {
  const slug = group.features[0]?.slug || `group-${group.n}`;
  const featureSummary = group.features.map(f => `- **F${f.id}** — ${f.slug} (${f.stories.length} stories)`).join('\n');
  const acceptanceLines = group.features.flatMap(f => f.acceptanceCriteria).map(a => `- [ ] ${a}`).join('\n');
  const nextGroup = group.n + 1;
  const resumePrompt = `implement group ${nextGroup} of ${planDir} per ${planDir}/.ai-harness/session-plan.md`;

  return `# Group ${group.n} — ${group.features.map(f => f.slug).join(' + ')}

## Goal

Implement ${group.features.length} feature(s) of the plan as a single context-budgeted unit.

## Features

${featureSummary}

## Acceptance

${acceptanceLines || '- [ ] (no acceptance criteria declared in member features)'}

## Token Estimate

~${group.tokens.toLocaleString()} tokens (profile: ${profileName})

## Resume Prompt

\`\`\`
${resumePrompt}
\`\`\`
`;
}
