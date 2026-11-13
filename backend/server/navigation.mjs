import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const fingerprints = new Map();
export const NAVIGATION_FORMAT = 1;

export function navigationInputs(map, mapsDir, assetsDir) {
  const folder = join(mapsDir, map.id);
  return [join(folder, map.scene), ...map.assets.map(asset => asset.file.startsWith('/assets/')
    ? join(assetsDir, asset.file.slice('/assets/'.length)) : join(folder, asset.file))];
}

/** Bind compiled paths to actual geometry, independently of Station labels. */
export async function navigationFingerprint(map, mapsDir, assetsDir) {
  const files = navigationInputs(map, mapsDir, assetsDir);
  const descriptor = JSON.stringify({
    format: NAVIGATION_FORMAT, generator: 'recast-0.43.1-default-v1',
    scene: map.scene, unitScale: map.unitScale, assets: map.assets,
    ground: map.ground, groundPlane: map.groundPlane, exclude: map.navigation.exclude
  });
  const metadata = await Promise.all(files.map(async file => {
    const info = await stat(file);
    return [file, info.size, info.mtimeMs, info.ctimeMs];
  }));
  const key = JSON.stringify([descriptor, metadata]);
  const previous = fingerprints.get(map.id);
  if (previous?.key === key) return previous.value;
  const hash = createHash('sha256').update(descriptor);
  for (const file of files) hash.update(await readFile(file));
  const value = hash.digest('hex');
  fingerprints.set(map.id, { key, value });
  return value;
}

export async function withPrebuiltNavigation(map, { mapsDir, assetsDir, navigationDir }) {
  try {
    const manifest = JSON.parse(await readFile(join(navigationDir, 'manifest.json'), 'utf8'));
    const entry = manifest.format === NAVIGATION_FORMAT ? manifest.maps?.[map.id] : null;
    if (!entry || !/^[a-z0-9-]+\.bin$/.test(entry.file)) return map;
    if (entry.fingerprint !== await navigationFingerprint(map, mapsDir, assetsDir)) return map;
    await stat(join(navigationDir, entry.file));
    return { ...map, navigation: { ...map.navigation, prebuilt: '/navigation/' + entry.file } };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Prebuilt navigation unavailable:', error.message);
    return map;
  }
}
