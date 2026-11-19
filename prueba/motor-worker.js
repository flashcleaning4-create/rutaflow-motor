// Worker del motor de rutas. Todo el cálculo ocurre en el móvil:
// - descarga solo las teselas del mapa de carreteras que hacen falta,
// - las guarda en el navegador (Cache Storage) para no volver a bajarlas,
// - calcula tablas de tiempos, rutas e indicaciones en español con Valhalla.
//
// Mensajes: { id, type: 'init' | 'matrix' | 'route', ... } → { id, ok, result | error }
// Progreso: { id, progress: { done, total, bytes } }
import { tilesForPoints } from './teselas.js';

const BASE = new URL('./', self.location.href); // raíz de la web
let manifest = null;
let available = null;
let valhalla = null;
let ValhallaError = null;
const tiles = new Map(); // ruta → bytes sin comprimir
let tileBytes = 0;
let downloadedBytes = 0;

// Límites de Valhalla: los de serie son para un servidor público. Aquí
// solo los usa este móvil, así que se suben para rutas de reparto.
const LIMITS = { max_locations: 250, max_matrix_location_pairs: 40000, max_matrix_distance: 400000, max_distance: 5000000 };
const CONFIG = {
  mjolnir: { max_cache_size: 268435456 },
  service_limits: { auto: LIMITS, truck: LIMITS, motorcycle: LIMITS, motor_scooter: LIMITS, bicycle: { ...LIMITS, max_matrix_distance: 200000 } },
};

const tileSource = { get: (path) => tiles.get(path) };

async function gunzip(bytes) {
  // Si el servidor ya lo descomprimió, no empieza por 1f 8b.
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function init() {
  if (manifest) return info();
  const res = await fetch(new URL('teselas/manifest.json', BASE), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo leer el mapa de carreteras (${res.status}).`);
  manifest = await res.json();
  available = new Set(Object.keys(manifest.tiles));

  // Borra teselas guardadas de mapas anteriores.
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith('rutaflow-teselas-') && name !== cacheName()) await caches.delete(name);
    }
  } catch { /* sin Cache Storage: se descargan cada vez */ }

  const lib = await import(new URL('motor/lib/index.js', BASE).href);
  ValhallaError = lib.ValhallaError;
  valhalla = await lib.loadValhalla({
    tiles: tileSource,
    config: CONFIG,
    wasmUrl: new URL('motor/dist/valhalla.wasm', BASE).href,
  });
  return info();
}

// Megas con un decimal si es poco.
const mb = (bytes) => { const v = bytes / 1048576; return v < 10 ? Math.round(v * 10) / 10 : Math.round(v); };

const cacheName = () => `rutaflow-teselas-${manifest.build}`;

function info() {
  return {
    build: manifest.build,
    createdAt: manifest.createdAt,
    tilesInMemory: tiles.size,
    memoryMB: mb(tileBytes),
    downloadedMB: mb(downloadedBytes),
    engineMB: valhalla ? Math.round(valhalla.memoryBytes / 1048576) : 0,
  };
}

async function loadTile(path, cache) {
  const url = new URL(manifest.base + path + '.gz', BASE).href;
  let res = cache ? await cache.match(url) : undefined;
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar una parte del mapa (${res.status}).`);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
    downloadedBytes += manifest.tiles[path] || 0;
  }
  const raw = await gunzip(new Uint8Array(await res.arrayBuffer()));
  tiles.set(path, raw);
  tileBytes += raw.byteLength;
}

async function ensureTiles(points, id, full = false) {
  const need = tilesForPoints(points, { available, full }).filter((p) => !tiles.has(p));
  if (need.length === 0) return 0;
  let cache = null;
  try { cache = await caches.open(cacheName()); } catch { cache = null; }
  let done = 0;
  const queue = [...need];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      await loadTile(queue.shift(), cache);
      done++;
      self.postMessage({ id, progress: { done, total: need.length, downloadedMB: mb(downloadedBytes) } });
    }
  });
  await Promise.all(workers);
  valhalla.reset(); // el motor vuelve a pedir las teselas que antes no tenía
  return need.length;
}

function costing(options) {
  const name = options.costing || 'auto';
  const opts = {};
  if (name !== 'bicycle') opts.use_tolls = options.avoidTolls ? 0 : 0.5;
  if (name === 'truck' && options.truck) Object.assign(opts, options.truck);
  return { costing: name, costing_options: { [name]: opts } };
}

// Errores de Valhalla que pueden deberse a que falta una parte del mapa.
const RETRY_CODES = new Set([170, 171, 442, 443]);

async function withTiles(points, id, run) {
  await ensureTiles(points, id);
  try {
    return run();
  } catch (err) {
    if (ValhallaError && err instanceof ValhallaError && RETRY_CODES.has(err.code)) {
      const added = await ensureTiles(points, id, true);
      if (added > 0) return run();
    }
    throw err;
  }
}

async function matrix({ points, options }, id) {
  const locations = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  const started = performance.now();
  const response = await withTiles(points, id, () =>
    valhalla.matrix({ sources: locations, targets: locations, ...costing(options) })
  );
  const n = points.length;
  const times = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const distances = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const rows = response.sources_to_targets;
  if (Array.isArray(rows) && Array.isArray(rows[0])) {
    // Formato detallado: filas de { from_index, to_index, time, distance }.
    for (const row of rows) for (const cell of row) {
      if (cell && cell.time != null) times[cell.from_index][cell.to_index] = cell.time;
      if (cell && cell.distance != null) distances[cell.from_index][cell.to_index] = cell.distance;
    }
  } else if (rows && Array.isArray(rows.durations)) {
    // Formato compacto (verbose: false).
    rows.durations.forEach((r, i) => r.forEach((v, j) => { if (v != null) times[i][j] = v; }));
    rows.distances?.forEach((r, i) => r.forEach((v, j) => { if (v != null) distances[i][j] = v; }));
  }
  for (let i = 0; i < n; i++) { times[i][i] = 0; distances[i][i] = 0; }
  return { times, distances, millis: Math.round(performance.now() - started), ...info() };
}

async function route({ points, options }, id) {
  const started = performance.now();
  const locations = points.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    type: 'break',
    // Llegar por el lado de la calle de la parada (no en la salida).
    ...(options.sameSide && i > 0 ? { preferred_side: 'same' } : {}),
  }));
  const response = await withTiles(points, id, () =>
    valhalla.route({
      locations,
      ...costing(options),
      directions_options: { language: 'es-ES', units: 'kilometers' },
    })
  );
  const trip = response.trip;
  return {
    summary: { km: trip.summary.length, seconds: trip.summary.time },
    legs: trip.legs.map((leg) => ({
      shape: leg.shape,
      km: leg.summary.length,
      seconds: leg.summary.time,
      maneuvers: leg.maneuvers.map((m) => ({
        text: m.instruction,
        verbal: m.verbal_pre_transition_instruction || m.instruction,
        km: m.length,
        seconds: m.time,
        type: m.type,
        shapeIndex: m.begin_shape_index,
      })),
    })),
    millis: Math.round(performance.now() - started),
    ...info(),
  };
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === 'init') result = await init();
    else {
      await init();
      if (type === 'matrix') result = await matrix(data, id);
      else if (type === 'route') result = await route(data, id);
      else throw new Error(`Acción desconocida: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: { message: err?.message || String(err), code: err?.code ?? null },
    });
  }
};
