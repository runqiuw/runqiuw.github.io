// Preserve source UVs, texture resolution and PBR channels; only change image encoding.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const dir = resolve(process.argv[2] ?? 'public/room/assets');
const selected = process.argv.slice(3);
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
const cli = fileURLToPath(new URL('../node_modules/.bin/gltf-transform', import.meta.url));
for (const [name, asset] of Object.entries(manifest.assets)) {
  if (!asset.preserve_materials || (selected.length && !selected.includes(name))) continue;
  const path = resolve(dir, asset.file);
  const result = spawnSync(cli, ['webp', path, path, '--quality', '95'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Texture encoding failed for ${name}`);
}
