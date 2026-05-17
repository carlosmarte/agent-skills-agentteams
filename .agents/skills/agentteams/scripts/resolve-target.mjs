#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';

export function resolveTarget({ argv = process.argv, env = process.env } = {}) {
  if (env.AGENTTEAMS_TARGET) return path.resolve(env.AGENTTEAMS_TARGET);
  const flagIdx = argv.indexOf('--target');
  if (flagIdx !== -1 && argv[flagIdx + 1]) return path.resolve(argv[flagIdx + 1]);
  try {
    const root = execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return path.join(root, 'agentteams');
  } catch {
    return path.resolve(process.cwd(), 'agentteams');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(resolveTarget() + '\n');
}
