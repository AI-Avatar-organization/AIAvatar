const CACHE_NAME = 'aiavatar-models-v1';

/** Keep large GLB bodies in Cache Storage, validating their saved ETag on each visit. */
export async function loadGlb(loader, url) {
  const absolute = new URL(url, location.href).href;
  let cache;
  let previous;
  try {
    cache = await caches.open(CACHE_NAME);
    previous = await cache.match(absolute);
  } catch { cache = undefined; }
  if (!cache) return loader.loadAsync(url);

  const etag = previous?.headers.get('etag');
  const response = await fetch(absolute, {
    cache: 'no-store',
    headers: etag ? { 'If-None-Match': etag } : {}
  });
  let model;
  if (response.status === 304 && previous) {
    model = previous;
  } else {
    if (!response.ok) throw new Error('Could not load 3D model: ' + response.status);
    model = response;
    try { await cache.put(absolute, response.clone()); } catch { /* Optional cache, e.g. quota exceeded. */ }
  }
  return loader.parseAsync(await model.arrayBuffer(), new URL('.', absolute).href);
}
