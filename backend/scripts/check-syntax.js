/**
 * Cross-platform syntax check: runs `node --check` on every backend source file.
 * Usage: npm run check
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'scripts', 'tests'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
roots.forEach((r) => {
  try {
    walk(r);
  } catch {
    /* optional dir */
  }
});

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${f}\n${err.stderr?.toString()}`);
  }
}
console.log(`${files.length - failed}/${files.length} files passed syntax check`);
process.exit(failed ? 1 : 0);
