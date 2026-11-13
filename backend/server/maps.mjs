import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

export class MapValidationError extends Error {
  constructor(file, field, message) {
    super(`${file}: ${field} ${message}`);
    this.file = file;
    this.field = field;
  }
}

/** English display text is optional; Thai `name` stays the primary name. */
const optionalText = (object, key) => (typeof object[key] === 'string' && object[key].trim() ? { [key]: object[key].trim() } : {});

const isVec3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

/** Validate a parsed map.json. Returns a normalized copy or throws MapValidationError naming the field. */
export function validateMap(raw, file = 'map.json') {
  const fail = (field, message) => { throw new MapValidationError(file, field, message); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('(root)', 'must be an object');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) fail('id', 'must be lowercase letters, digits or dashes');
  if (typeof raw.name !== 'string' || !raw.name.trim()) fail('name', 'is required');
  if (typeof raw.scene !== 'string' || !/^[\w.-]+\.glb$/.test(raw.scene)) fail('scene', 'must be a .glb file name in the map folder');
  const unitScale = raw.unitScale ?? 1;
  if (!Number.isFinite(unitScale) || unitScale <= 0) fail('unitScale', 'must be a positive number');
  const spawn = raw.spawn ?? { position: [0, 0, 0], facing: 0 };
  if (!isVec3(spawn.position)) fail('spawn.position', 'must be [x, y, z]');
  if (!Array.isArray(raw.stations)) fail('stations', 'must be an array');
  const seen = new Set();
  const stations = raw.stations.map((station, index) => {
    const at = `stations[${index}]`;
    if (typeof station?.id !== 'string' || !ID.test(station.id)) fail(`${at}.id`, 'must be lowercase letters, digits or dashes');
    if (seen.has(station.id)) fail(`${at}.id`, `duplicates "${station.id}"`);
    seen.add(station.id);
    if (typeof station.name !== 'string' || !station.name.trim()) fail(`${at}.name`, 'is required');
    if (!isVec3(station.position)) fail(`${at}.position`, 'must be [x, y, z]');
    const aliases = station.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.some(alias => typeof alias !== 'string')) fail(`${at}.aliases`, 'must be an array of strings');
    return {
      id: station.id, name: station.name.trim(), ...optionalText(station, 'nameEn'), aliases: aliases.map(a => a.trim()).filter(Boolean),
      position: station.position, facing: Number.isFinite(station.facing) ? station.facing : 0,
      description: typeof station.description === 'string' ? station.description : ''
    };
  });
  // Assets placed into this Map (buildings, props). file is package-relative or a shared /assets/places/*.glb.
  const assets = (raw.assets ?? []).map((asset, index) => {
    const at = `assets[${index}]`;
    if (typeof asset?.id !== 'string' || !ID.test(asset.id)) fail(`${at}.id`, 'must be lowercase letters, digits or dashes');
    if (typeof asset.file !== 'string' || !/^(?:[\w.-]+|\/assets\/places\/[\w.-]+)\.glb$/.test(asset.file)) fail(`${at}.file`, 'must be a .glb in the map folder or /assets/places/');
    if (!isVec3(asset.position ?? [0, 0, 0])) fail(`${at}.position`, 'must be [x, y, z]');
    return { id: asset.id, name: typeof asset.name === 'string' ? asset.name : asset.id, file: asset.file,
      position: asset.position ?? [0, 0, 0], rotationY: Number.isFinite(asset.rotationY) ? asset.rotationY : 0,
      scale: Number.isFinite(asset.scale) && asset.scale > 0 ? asset.scale : 1 };
  });
  // Connectors: authored stairs/ramps between levels the generated navmesh cannot join (lower end first).
  const connectors = (raw.connectors ?? []).map((connector, index) => {
    const at = `connectors[${index}]`;
    if (typeof connector?.id !== 'string' || !ID.test(connector.id)) fail(`${at}.id`, 'must be lowercase letters, digits or dashes');
    if (!Array.isArray(connector.points) || connector.points.length < 2 || !connector.points.every(isVec3)) fail(`${at}.points`, 'must be 2+ [x, y, z] points');
    return { id: connector.id, points: connector.points };
  });
  const exclude = raw.navigation?.exclude ?? 'roof|cloud|ceiling|detail|holder|icosphere';
  try { new RegExp(exclude, 'i'); } catch { fail('navigation.exclude', 'must be a valid regular expression'); }
  return {
    id: raw.id, name: raw.name.trim(), ...optionalText(raw, 'nameEn'), ...optionalText(raw, 'descriptionEn'), assets, connectors, navigation: { exclude }, description: raw.description ?? '', scene: raw.scene, unitScale,
    version: Number.isInteger(raw.version) ? raw.version : 1,
    ground: Array.isArray(raw.ground) ? raw.ground.filter(n => typeof n === 'string') : [],
    groundPlane: raw.groundPlane !== false,
    spawn: { position: spawn.position, facing: Number.isFinite(spawn.facing) ? spawn.facing : 0 },
    camera: raw.camera && isVec3(raw.camera.position) && isVec3(raw.camera.target) ? raw.camera : null,
    stations
  };
}

/** Scan <dir>/<mapId>/map.json. Invalid packages are reported, not fatal. */
export async function loadRegistry(dir) {
  const maps = new Map();
  const errors = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return { maps, errors }; }
  for (const entry of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(dir, entry.name, 'map.json');
    try {
      const map = validateMap(JSON.parse(await readFile(file, 'utf8')), `maps/${entry.name}/map.json`);
      if (map.id !== entry.name) throw new MapValidationError(`maps/${entry.name}/map.json`, 'id', `must equal folder name "${entry.name}"`);
      await stat(join(dir, entry.name, map.scene));
      maps.set(map.id, map);
    } catch (error) {
      if (error.code === 'ENOENT' && error.path?.endsWith('map.json')) continue; // folder without a package yet
      errors.push(error.message);
    }
  }
  return { maps, errors };
}

/** Validate and write a map.json back into its package (Author mode). Bumps version. */
export async function saveMap(dir, id, raw) {
  const { writeFile, rename } = await import('node:fs/promises');
  const file = join(dir, id, 'map.json');
  const current = validateMap(JSON.parse(await readFile(file, 'utf8')), `maps/${id}/map.json`);
  const next = validateMap({ ...raw, id, scene: current.scene, version: current.version + 1 }, `maps/${id}/map.json`);
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(next, null, 2) + '\n');
  await rename(temporary, file);
  return next;
}
