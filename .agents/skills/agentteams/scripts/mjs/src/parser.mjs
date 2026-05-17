// Plan-tree parser. Walks features/, stories/, tasks/ and emits a typed AST.
import fs from 'node:fs';
import path from 'node:path';

const RE_HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const RE_CHECKBOX = /^\s*-\s*\[( |x|X)\]\s+(.+?)\s*$/;
const RE_BULLET = /^\s*-\s+(.+?)\s*$/;
const RE_TABLE_ROW = /^\s*\|(.+)\|\s*$/;

export function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: {}, body: text };
  const block = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n/, '');
  const fm = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { frontmatter: fm, body };
}

export function parseSections(body) {
  const out = {};
  const lines = body.split('\n');
  let currentH2 = null;
  let buf = [];
  const flush = () => {
    if (currentH2 !== null) out[currentH2] = buf.join('\n').trim();
  };
  for (const line of lines) {
    const m = line.match(RE_HEADING);
    if (m && m[1].length === 2) {
      flush();
      currentH2 = m[2].trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export function parseAcceptanceCriteria(section) {
  if (!section) return [];
  return section.split('\n').map(l => l.match(RE_CHECKBOX)).filter(Boolean).map(m => m[2]);
}

export function parseTable(section) {
  if (!section) return [];
  const rows = section.split('\n').filter(l => RE_TABLE_ROW.test(l));
  if (rows.length < 2) return [];
  const headers = rows[0].split('|').slice(1, -1).map(c => c.trim().toLowerCase());
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const cells = rows[i].split('|').slice(1, -1).map(c => c.trim());
    if (cells.length === headers.length) {
      const row = {};
      headers.forEach((h, idx) => (row[h] = cells[idx]));
      out.push(row);
    }
  }
  return out;
}

export function parseBullets(section) {
  if (!section) return [];
  return section.split('\n').map(l => l.match(RE_BULLET)).filter(Boolean).map(m => m[1]);
}

export function parseDependencies(section) {
  if (!section) return [];
  const txt = section.trim();
  if (/^none\.?$/i.test(txt) || /^-\s*none\.?\s*$/i.test(txt)) return [];
  return parseBullets(section);
}

function readMd(p) {
  try {
    return readFile(p);
  } catch {
    return null;
  }
}

function parseDoc(filePath) {
  const text = readMd(filePath);
  if (text == null) return null;
  const { frontmatter, body } = parseFrontmatter(text);
  const sections = parseSections(body);
  return { path: filePath, frontmatter, body, sections, raw: text };
}

function listDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch {
    return [];
  }
}

function listFiles(p, ext = '.md') {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith(ext))
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function parsePlan(planDir) {
  if (!fs.existsSync(planDir)) {
    throw Object.assign(new Error(`plan-not-found: ${planDir}`), { code: 'PLAN_NOT_FOUND' });
  }
  const warnings = [];

  const readmePath = path.join(planDir, 'README.md');
  const readme = parseDoc(readmePath);
  if (!readme) warnings.push({ level: 'WARN', code: 'no-readme', path: readmePath });

  const featuresDir = path.join(planDir, 'features');
  const storiesDir = path.join(planDir, 'stories');
  const tasksDir = path.join(planDir, 'tasks');

  const featureFiles = listFiles(featuresDir);
  const features = [];
  for (const fname of featureFiles) {
    const fpath = path.join(featuresDir, fname);
    const doc = parseDoc(fpath);
    if (!doc) continue;
    const id = (fname.match(/^(\d+)/) || [])[1] || fname;
    const slug = fname.replace(/^\d+-/, '').replace(/\.md$/, '');
    const ac = parseAcceptanceCriteria(doc.sections['Acceptance Criteria']);
    const storyTable = parseTable(doc.sections['Stories']);
    const featureNum = id.padStart(2, '0');
    const storyDir = path.join(storiesDir, featureNum);
    const storyFiles = listFiles(storyDir);
    const stories = [];
    for (const sname of storyFiles) {
      const spath = path.join(storyDir, sname);
      const sdoc = parseDoc(spath);
      if (!sdoc) continue;
      const sid = (sname.match(/^(\d+)/) || [])[1] || sname;
      const sslug = sname.replace(/^\d+-/, '').replace(/\.md$/, '');
      const sac = parseAcceptanceCriteria(sdoc.sections['Acceptance Criteria']);
      const sdeps = parseDependencies(sdoc.sections['Dependencies']);
      const taskDir = path.join(tasksDir, featureNum, sid.padStart(2, '0'));
      const taskFiles = listFiles(taskDir);
      if (taskFiles.length === 0) warnings.push({ level: 'WARN', code: 'tasks-not-expanded', path: taskDir });
      const tasks = [];
      for (const tname of taskFiles) {
        const tpath = path.join(taskDir, tname);
        const tdoc = parseDoc(tpath);
        if (!tdoc) continue;
        const tid = (tname.match(/^(\d+)/) || [])[1] || tname;
        const tslug = tname.replace(/^\d+-/, '').replace(/\.md$/, '');
        tasks.push({
          id: tid,
          slug: tslug,
          path: tpath,
          targetFiles: parseBullets(tdoc.sections['Target Files']),
          verification: parseAcceptanceCriteria(tdoc.sections['Verification']),
          context: tdoc.sections['Context'] || '',
          changes: tdoc.sections['Changes'] || '',
        });
      }
      stories.push({
        id: sid,
        slug: sslug,
        path: spath,
        featureId: id,
        acceptanceCriteria: sac,
        dependencies: sdeps,
        context: sdoc.sections['Context'] || '',
        tasks,
      });
    }
    features.push({
      id,
      slug,
      path: fpath,
      acceptanceCriteria: ac,
      storyTable,
      stories,
    });
  }

  return {
    planDir,
    readme: readme ? { path: readme.path, sections: readme.sections, raw: readme.raw } : null,
    features,
    warnings,
  };
}
