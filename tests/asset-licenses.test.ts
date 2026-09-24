import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every third-party-derived file under public/models and public/textures must
 * be listed (by its path relative to public/) in public/ASSETS_LICENSES.md.
 */
const PUBLIC = join(__dirname, '..', 'public');

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(walk(path));
    else out.push(path);
  }
  return out;
}

describe('asset license manifest', () => {
  const manifest = readFileSync(join(PUBLIC, 'ASSETS_LICENSES.md'), 'utf8');
  const files = ['models', 'textures']
    .flatMap((d) => walk(join(PUBLIC, d)))
    .map((f) => relative(PUBLIC, f).split('\\').join('/'));

  it('finds the shipped asset directories', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has a license entry', (file) => {
    expect(manifest).toContain(`\`${file}\``);
  });
});
