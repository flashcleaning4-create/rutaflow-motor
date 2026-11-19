// Buscador de direcciones con CartoCiudad (Instituto Geográfico Nacional).
// Servicio público y gratuito para España: calles, portales, puntos de
// interés, carreteras y topónimos. Datos © IGN / CartoCiudad (CC BY 4.0).
const API = 'https://www.cartociudad.es/geocoder/api/geocoder';

// Tipos que no sirven como parada (son áreas, no direcciones).
const SKIP = 'municipio,provincia,comunidad autonoma,poblacion,Codpost';

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`CartoCiudad respondió ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

// CartoCiudad devuelve los nombres en mayúsculas: «CARRER DE BALMES» → «Carrer de Balmes».
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'i', 'a', 'en', 'dels', 'les', 'da', 'do', 'das', 'dos']);
export function titleCase(text) {
  return String(text || '')
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((w, i) => {
      if (!w.trim() || w === '-' || w === '/') return w;
      if (i > 0 && SMALL.has(w)) return w;
      // d'Aragó, l'Hospitalet
      const m = w.match(/^([dl]')(.+)$/);
      if (m) {
        const prefix = i === 0 ? m[1].toUpperCase() : m[1];
        return prefix + m[2].charAt(0).toUpperCase() + m[2].slice(1);
      }
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join('');
}

function label(c) {
  const street = titleCase([c.tip_via, c.address].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
  const number = c.portalNumber ? `, ${c.portalNumber}${c.extension || ''}` : '';
  const place = [c.postalCode, titleCase(c.poblacion || c.muni), titleCase(c.province)].filter(Boolean);
  // Evita repetir el municipio si ya viene en la población.
  const unique = place.filter((v, i) => place.indexOf(v) === i);
  return { title: `${street}${number}`, subtitle: unique.join(', ') };
}

/** Sugerencias mientras se escribe. */
export async function suggest(query, signal) {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `${API}/candidates?q=${encodeURIComponent(q)}&limit=8&no_process=${encodeURIComponent(SKIP)}`;
  const list = (await getJson(url, signal)) || [];
  return list.map((c) => ({ ...label(c), raw: c }));
}

function firstPointOfGeom(geom) {
  if (!geom) return null;
  try {
    const g = typeof geom === 'string' ? JSON.parse(geom) : geom;
    let coords = g.coordinates;
    while (Array.isArray(coords) && Array.isArray(coords[0])) {
      // Para una línea o polígono, el punto central de la lista.
      coords = coords[Math.floor(coords.length / 2)];
    }
    if (Array.isArray(coords) && coords.length >= 2) return { lon: Number(coords[0]), lat: Number(coords[1]) };
  } catch { /* WKT u otro formato: se ignora */ }
  const m = String(geom).match(/(-?\d+\.\d+)\s+(-?\d+\.\d+)/);
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

/** Coordenadas de una sugerencia. */
export async function resolve(suggestion) {
  const c = suggestion.raw;
  if (c.lat && c.lng) return { lat: c.lat, lon: c.lng };
  const params = new URLSearchParams({ id: c.id, type: c.type });
  if (c.portalNumber) params.set('portal', String(c.portalNumber));
  const found = await getJson(`${API}/find?${params}`);
  if (found?.lat && found?.lng) return { lat: found.lat, lon: found.lng };
  const p = firstPointOfGeom(found?.geom);
  if (p) return p;
  throw new Error('CartoCiudad no devolvió coordenadas para esa dirección.');
}

/** Dirección más cercana a un punto del mapa (hasta 350 m). */
export async function reverse(lat, lon) {
  const c = await getJson(`${API}/reverseGeocode?lon=${lon}&lat=${lat}`);
  if (!c) return null;
  return label(c);
}

/** Primera coincidencia de un texto (para importar una lista). */
export async function geocodeText(text) {
  const list = await suggest(text);
  if (!list.length) return null;
  const point = await resolve(list[0]);
  return { ...list[0], ...point };
}
