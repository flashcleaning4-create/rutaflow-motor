// Qué teselas del mapa de carreteras (Valhalla) hacen falta para unas
// paradas. Nivel 0: autopistas (4°), nivel 1: carreteras principales (1°),
// nivel 2: calles (0,25°). Sin dependencias: se usa en el worker y en pruebas.

export const LEVELS = [
  { level: 0, size: 4, digits: 6 },
  { level: 1, size: 1, digits: 6 },
  { level: 2, size: 0.25, digits: 9 },
];

/** Ruta de una tesela: "2/000/781/229.gph". */
export function tilePath(level, id) {
  const { digits } = LEVELS[level];
  const groups = String(id).padStart(digits, '0').match(/\d{3}/g);
  const file = groups.pop();
  return [String(level), ...groups, `${file}.gph`].join('/');
}

function rowCol(lat, lon, size) {
  return {
    row: Math.floor((Math.min(Math.max(lat, -90), 89.999999) + 90) / size),
    col: Math.floor((((lon + 180) % 360) + 360) % 360 / size),
  };
}

/** Teselas de un nivel que tocan un rectángulo. */
export function tilesInBox(level, box) {
  const { size } = LEVELS[level];
  const cols = Math.round(360 / size);
  const a = rowCol(box.south, box.west, size);
  const b = rowCol(box.north, box.east, size);
  const out = [];
  for (let row = a.row; row <= b.row; row++) {
    for (let col = a.col; col <= b.col; col++) {
      out.push(tilePath(level, row * cols + col));
    }
  }
  return out;
}

function boxOf(points, pad = 0) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  return { south: south - pad, north: north + pad, west: west - pad, east: east + pad };
}

/**
 * Teselas necesarias para calcular rutas entre estos puntos.
 * - Zona pequeña (reparto en una ciudad o comarca): todas las calles de la zona.
 * - Zona grande: las calles cerca de cada punto (unos 6 km) y las carreteras
 *   principales y autopistas de toda la zona. Valhalla solo usa las calles
 *   cerca del origen y del destino de cada tramo.
 * `available` (opcional): conjunto de teselas que existen (las del mar no).
 */
export function tilesForPoints(points, { available, full = false } = {}) {
  if (points.length === 0) return [];
  const need = new Set();
  for (const p of tilesInBox(0, boxOf(points, 0.05))) need.add(p);
  for (const p of tilesInBox(1, boxOf(points, 0.1))) need.add(p);
  const all = boxOf(points, 0.05);
  const small = all.north - all.south <= 0.75 && all.east - all.west <= 0.75;
  if (small || full) {
    for (const p of tilesInBox(2, all)) need.add(p);
  } else {
    for (const pt of points) {
      for (const p of tilesInBox(2, {
        south: pt.lat - 0.06,
        north: pt.lat + 0.06,
        west: pt.lon - 0.08,
        east: pt.lon + 0.08,
      })) need.add(p);
    }
  }
  const list = [...need];
  return available ? list.filter((p) => available.has(p)) : list;
}
