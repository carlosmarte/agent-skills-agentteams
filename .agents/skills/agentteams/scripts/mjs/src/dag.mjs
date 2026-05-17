// Dependency DAG construction, Kahn's topo sort, cycle detection, P0/P1/P2 prioritization.

const RISK_HINTS = ['security', 'data loss', 'regression', 'incident', 'compliance'];
const DEP_PHRASES = [
  /depends on\s+([A-Za-z0-9_/.\- #]+)/gi,
  /blocked by\s+([A-Za-z0-9_/.\- #]+)/gi,
  /requires\s+([A-Za-z0-9_/.\- #]+?)\s+to land/gi,
  /after\s+([A-Za-z0-9_/.\- #]+?)\s+lands/gi,
  /consumes\s+([A-Za-z0-9_/.\- #]+)/gi,
];

function nodeId(featureId, storyId) {
  return `F${featureId}.S${storyId}`;
}

function extractInlineDeps(text) {
  if (!text) return [];
  const ids = new Set();
  for (const re of DEP_PHRASES) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const ref = m[1].trim();
      const ext = ref.match(/F(\d+)[ .\-]?S?(\d+)?/i);
      if (ext) {
        if (ext[2]) ids.add(`F${ext[1].padStart(2, '0')}.S${ext[2].padStart(2, '0')}`);
        else ids.add(`F${ext[1].padStart(2, '0')}`);
      }
    }
  }
  return [...ids];
}

function normalizeDepRef(raw, currentFeatureId) {
  const m = raw.match(/F(\d+)[ .\-/]?S?(\d+)?/i);
  if (m) {
    if (m[2]) return `F${m[1].padStart(2, '0')}.S${m[2].padStart(2, '0')}`;
    return `F${m[1].padStart(2, '0')}`;
  }
  const sm = raw.match(/S(\d+)/i);
  if (sm && currentFeatureId) return `F${currentFeatureId}.S${sm[1].padStart(2, '0')}`;
  return null;
}

export function buildDag(plan, opts = {}) {
  const implicit = opts.implicit !== false;
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  for (const feature of plan.features) {
    for (const story of feature.stories) {
      const id = nodeId(feature.id, story.id);
      const node = {
        id,
        type: 'story',
        featureId: feature.id,
        storyId: story.id,
        slug: story.slug,
        path: story.path,
        acceptanceCriteria: story.acceptanceCriteria,
        taskCount: story.tasks.length,
        risk: detectRisk(story),
      };
      nodes.push(node);
      nodeMap.set(id, node);
    }
  }

  for (const feature of plan.features) {
    for (let i = 0; i < feature.stories.length; i++) {
      const story = feature.stories[i];
      const id = nodeId(feature.id, story.id);
      const featurePadded = feature.id.padStart(2, '0');
      const explicit = (story.dependencies || []).map(d => normalizeDepRef(d, featurePadded)).filter(Boolean);
      const inline = extractInlineDeps(story.context).map(d => {
        return d.includes('.') ? d : null;
      }).filter(Boolean);

      const declaredNone = /none/i.test((story.dependencies || []).join(' ').trim()) || (story.dependencies || []).length === 0;

      const allDeps = new Set([...explicit, ...inline]);

      if (implicit && declaredNone && i > 0) {
        const prev = feature.stories[i - 1];
        allDeps.add(nodeId(feature.id, prev.id));
      } else if (implicit && !declaredNone && i > 0) {
        // explicit deps win, but still add prior story if not declared none
      }

      // Feature-level implicit: F02.S01 depends on F01's last story
      if (implicit && story.id === '01' && plan.features.indexOf(feature) > 0) {
        const prevFeature = plan.features[plan.features.indexOf(feature) - 1];
        if (prevFeature.stories.length > 0) {
          const lastPrev = prevFeature.stories[prevFeature.stories.length - 1];
          allDeps.add(nodeId(prevFeature.id, lastPrev.id));
        }
      }

      for (const from of allDeps) {
        if (nodeMap.has(from) && from !== id) {
          edges.push({ from, to: id });
        }
      }
    }
  }

  return { nodes, edges, nodeMap };
}

function detectRisk(story) {
  const hay = (story.context + ' ' + story.acceptanceCriteria.join(' ')).toLowerCase();
  return RISK_HINTS.filter(h => hay.includes(h));
}

export function topoSort(dag) {
  const { nodes, edges } = dag;
  const indeg = new Map();
  const adj = new Map();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.to) || !adj.has(e.from)) continue;
    indeg.set(e.to, indeg.get(e.to) + 1);
    adj.get(e.from).push(e.to);
  }
  const queue = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  queue.sort();
  const order = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    for (const next of adj.get(cur) || []) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  const cycles = order.length === nodes.length ? [] : findCycles(dag);
  return { order, cycles };
}

function findCycles(dag) {
  const { nodes, edges } = dag;
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) (adj.get(e.from) || []).push(e.to);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(nodes.map(n => [n.id, WHITE]));
  const cycles = [];
  const stack = [];

  function dfs(u) {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) || []) {
      if (color.get(v) === GRAY) {
        const idx = stack.indexOf(v);
        cycles.push(stack.slice(idx).concat([v]));
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  }
  for (const n of nodes) if (color.get(n.id) === WHITE) dfs(n.id);
  return cycles;
}

export function prioritize(dag, topo) {
  const { nodes, edges } = dag;
  // count downstream blockers (transitive)
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) (adj.get(e.from) || []).push(e.to);
  const downstream = new Map();
  function count(id, seen = new Set()) {
    if (downstream.has(id)) return downstream.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    let c = 0;
    for (const v of adj.get(id) || []) {
      c += 1 + count(v, seen);
    }
    downstream.set(id, c);
    return c;
  }
  for (const n of nodes) count(n.id);

  const out = nodes.map(n => {
    const blockers = downstream.get(n.id) || 0;
    let tier = 'P2';
    if (blockers >= 3) tier = 'P1';
    if (blockers >= 6) tier = 'P0';
    if (n.risk.length > 0 && tier === 'P1') tier = 'P0';
    return { ...n, blockersDownstream: blockers, tier };
  });
  out.sort((a, b) => {
    const order = { P0: 0, P1: 1, P2: 2 };
    if (order[a.tier] !== order[b.tier]) return order[a.tier] - order[b.tier];
    if (b.blockersDownstream !== a.blockersDownstream) return b.blockersDownstream - a.blockersDownstream;
    return a.id.localeCompare(b.id);
  });
  return out;
}
