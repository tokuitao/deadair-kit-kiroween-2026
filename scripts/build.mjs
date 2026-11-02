import { cp, mkdir, rm, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'src'), dist, { recursive: true });
await cp(resolve(root, 'apps'), resolve(dist, 'apps'), { recursive: true });
await mkdir(resolve(dist, 'vendor'), { recursive: true });
const dependencies = [
  ['qrcode-generator', ['dist/qrcode.js', 'qrcode.js'], 'qrcode.js'],
  ['jsqr', ['dist/jsQR.js'], 'jsQR.js'],
];
const licenses = [];
for (const [name, candidates, output] of dependencies) {
  let source;
  for (const file of candidates) {
    const path = resolve(root, 'node_modules', name, file);
    try { await access(path); source = path; break; } catch {}
  }
  if (!source) throw new Error(`Missing installed browser library: ${name}`);
  await cp(source, resolve(dist, 'vendor', output));
  let license;
  try { license = await readFile(resolve(root, 'node_modules', name, 'LICENSE'), 'utf8'); }
  catch (error) {
    if (name !== 'qrcode-generator') throw error;
    const sourceText = await readFile(source, 'utf8');
    const copyright = sourceText.match(/Copyright \(c\) 2009 Kazuhiko Arase/)?.[0];
    if (!copyright || !sourceText.includes('Licensed under the MIT license')) throw error;
    license = (await readFile(resolve(root, 'LICENSE'), 'utf8')).replace(/Copyright \(c\) 2026 DeadAir Kit contributors/, copyright);
  }
  licenses.push(`${name}\n${'='.repeat(name.length)}\n${license}`);
}
await writeFile(resolve(dist, 'vendor', 'LICENSES.txt'), licenses.join('\n\n'));
const hash = createHash('sha256');
async function fingerprint(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await fingerprint(file);
    else if (entry.name !== 'sw.js') hash.update(file.slice(dist.length)).update(await readFile(file));
  }
}
await fingerprint(dist);
const sw = await readFile(resolve(dist, 'sw.js'), 'utf8');
await writeFile(resolve(dist, 'sw.js'), sw.replace(/const CACHE = '[^']+'/, `const CACHE = 'deadair-${hash.digest('hex').slice(0, 16)}'`));
console.log(`Built ${dist}`);
