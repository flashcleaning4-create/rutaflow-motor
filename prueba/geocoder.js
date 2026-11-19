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

// Quita acentos y pasa a minúsculas para comparar.
export function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñç ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tipos de vía (en castellano, catalán, gallego y euskera) y partículas
// que CartoCiudad no necesita: «Carrer de Balmes 40» → «Balmes 40».
const STREET_TYPES = new Set([
  'c', 'cl', 'c/', 'calle', 'carrer', 'rua', 'kalea', 'av', 'avd', 'avda', 'avenida', 'avinguda',
  'etorbidea', 'pso', 'paseo', 'passeig', 'pg', 'pl', 'pza', 'plaza', 'placa', 'plaça', 'praza',
  'ronda', 'rda', 'travesia', 'travessera', 'trav', 'camino', 'cami', 'cno', 'carretera', 'ctra',
  'rambla', 'via', 'glorieta', 'gta', 'urbanizacion', 'urb', 'poligono', 'pol', 'passatge', 'pasaje',
]);
const PARTICLES = new Set(['de', 'del', 'de la', 'dels', 'de les', 'da', 'do', 'das', 'dos', 'la', 'el', 'les', 'els']);

/**
 * Separa una dirección escrita a mano en calle, número y municipio.
 * «Carrer de Balmes 40, Barcelona» → { street: 'balmes', number: 40, place: 'barcelona' }
 */
export function parseAddress(text) {
  const parts = String(text || '').split(',').map((p) => p.trim()).filter(Boolean);
  let first = parts.shift() || '';
  let number = null;
  // Número al final de la primera parte («Balmes 40», «Balmes 40 B», «Balmes nº 40»)
  // o como segunda parte («Balmes, 40, Barcelona»).
  let m = first.match(/^(.*?)\s*(?:n[ºo°]\.?\s*)?(\d{1,4})\s*[a-zA-Z]?$/);
  if (m && m[1]) {
    first = m[1];
    number = Number(m[2]);
  } else if (parts.length && /^\d{1,4}\s*[a-zA-Z]?$/.test(parts[0])) {
    number = parseInt(parts.shift(), 10);
  } else if (!parts.length && (m = first.match(/^(.*?\D)\s+(?:n[ºo°]\.?\s*)?(\d{1,4})\s*[a-zA-Z]?\s+(\D.*)$/))) {
    // Sin comas: «calle balmes 40 barcelona»
    first = m[1];
    number = Number(m[2]);
    parts.push(m[3]);
  }
  let words = normalize(first).split(' ').filter(Boolean);
  while (words.length > 1 && STREET_TYPES.has(words[0].replace(/\.$/, ''))) words.shift();
  // «d'Aragó» llega como «d arago»
  while (words.length > 1 && (PARTICLES.has(words[0]) || words[0] === 'd' || words[0] === 'l')) words.shift();
  const place = normalize(parts.join(' ').replace(/\b\d{5}\b/g, ' '));
  const postal = (String(text).match(/\b(\d{5})\b/) || [])[1] || null;
  return { street: words.join(' '), number, place, postal };
}

function candidateStreet(c) {
  // address: «CALLE BALMES 41, Barcelona» → «balmes»
  const before = String(c.address || '').split(',')[0].replace(/\s+\d+\s*[a-z]?$/i, '');
  const words = normalize(before).split(' ');
  while (words.length > 1 && STREET_TYPES.has(words[0])) words.shift();
  return words.join(' ');
}

/** Puntuación de un candidato frente a lo que se escribió (mayor = mejor). */
export function scoreCandidate(c, wanted) {
  let score = 0;
  const muni = normalize(c.muni);
  const pob = normalize(c.poblacion);
  if (wanted.place && (wanted.place.includes(muni) || muni.includes(wanted.place) || (pob && wanted.place.includes(pob)))) score += 100;
  if (wanted.postal && c.postalCode === wanted.postal) score += 100;
  const street = candidateStreet(c);
  if (wanted.street) {
    if (street === wanted.street) score += 40;
    else if (street.endsWith(' ' + wanted.street) || street.includes(wanted.street)) score += 15;
  }
  if (wanted.number != null && c.portalNumber != null) {
    const diff = Math.abs(c.portalNumber - wanted.number);
    if (diff === 0) score += 50;
    else if (diff % 2 === 0) score += Math.max(0, 30 - diff); // mismo lado de la calle
    else score += Math.max(0, 10 - diff);
  }
  return score;
}

function label(c) {
  // address suele traer tipo de vía, nombre y número («CALLE BALMES 41, Barcelona»);
  // la búsqueda inversa a veces solo el nombre («CATALUNYA»): se completa.
  let base = String(c.address || '').split(',')[0].replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  if (c.tip_via && base && !normalize(base).startsWith(normalize(c.tip_via))) base = `${c.tip_via} ${base}`;
  if (c.portalNumber && base && !/\d/.test(base)) base += ` ${c.portalNumber}${c.extension || ''}`;
  const place = [c.postalCode, titleCase(c.poblacion || c.muni)].filter(Boolean);
  const province = titleCase(c.province);
  if (province && !place.includes(province)) place.push(province);
  return { title: titleCase(base) || titleCase(c.muni) || 'Dirección', subtitle: place.join(', ') };
}

function distanceKm(a, b) {
  const t = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * t / 2) ** 2 +
    Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin((b.lon - a.lon) * t / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

async function candidates(query, signal, limit) {
  const url = `${API}/candidates?q=${encodeURIComponent(query)}&limit=${limit}&no_process=${encodeURIComponent(SKIP)}`;
  return (await getJson(url, signal)) || [];
}

/**
 * Sugerencias para lo escrito, las más parecidas primero.
 * `near` (opcional): punto de referencia (última parada o centro del mapa);
 * sin municipio escrito, se prefieren las direcciones cercanas.
 */
export async function suggest(query, signal, near) {
  const q = query.trim();
  if (q.length < 3) return [];
  const wanted = parseAddress(q);
  // Se busca sin «Carrer de», «Calle»… y con el municipio al final.
  const clean = [wanted.street, wanted.number, wanted.place].filter((v) => v != null && v !== '').join(' ');
  const list = await candidates(clean || q, signal, 15);
  return list
    .map((c, i) => {
      let score = scoreCandidate(c, wanted);
      if (near && c.lat && c.lng && !wanted.place && !wanted.postal) {
        score += Math.max(0, 60 - distanceKm(near, { lat: c.lat, lon: c.lng }) / 2);
      }
      return { c, i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 8)
    .map(({ c }) => {
      const l = label(c);
      // Avisa si el portal no es exactamente el pedido.
      if (wanted.number != null && c.portalNumber != null && c.portalNumber !== wanted.number) {
        l.subtitle += ` · pediste el nº ${wanted.number}`;
      }
      return { ...l, raw: c };
    });
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
export async function geocodeText(text, near) {
  const list = await suggest(text, undefined, near);
  if (!list.length) return null;
  const point = await resolve(list[0]);
  return { ...list[0], ...point };
}
