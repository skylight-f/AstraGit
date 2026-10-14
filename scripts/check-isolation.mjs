import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = new Map();
const errors = [];

function insideRoot(path) {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !part.startsWith(sep);
}

function scanSources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (!insideRoot(realpathSync(path))) errors.push(`External source link: ${relative(root, path)}`);
    } else if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.tmp', '.git'].includes(entry.name)) scanSources(path);
    } else if (/\.(?:[cm]?tsx?|json|ya?ml|mjs)$/u.test(entry.name) && !entry.name.endsWith('.tsbuildinfo')) {
      if (/@zeus\/|zeus\/packages|(?:\.\.\/)+zeus\//u.test(readFileSync(path, 'utf8'))) {
        errors.push(`Zeus source dependency: ${relative(root, path)}`);
      }
    }
  }
}

for (const area of ['packages', 'apps']) {
  for (const entry of readdirSync(join(root, area), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, area, entry.name);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    packages.set(manifest.name, { directory, manifest });
    scanSources(directory);
  }
}

for (const { directory, manifest } of packages.values()) {
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (!version.startsWith('workspace:')) continue;
    const target = packages.get(name);
    if (!target) {
      errors.push(`Missing local workspace package: ${name}`);
      continue;
    }
    const linked = realpathSync(join(directory, 'node_modules', name));
    if (linked !== target.directory || !insideRoot(linked)) errors.push(`Workspace package resolves outside AstraGit: ${name}`);
  }
}

for (const config of ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'tsconfig.base.json']) {
  if (/@zeus\/|zeus\/packages|link:[^\n]*zeus/iu.test(readFileSync(join(root, config), 'utf8'))) {
    errors.push(`Zeus dependency in ${config}`);
  }
}

if (errors.length) throw new Error(errors.join('\n'));
console.info(`Isolation passed: ${packages.size} local packages; no Zeus source or package links.`);
