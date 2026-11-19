// Página de prueba de RutaFlow sin servicios de pago:
// mapa libre (OpenFreeMap), direcciones de CartoCiudad y rutas calculadas
// en el propio dispositivo (motor-worker.js).
import { suggest, resolve, reverse, geocodeText } from './geocoder.js';
import { optimizeOrder } from './optimizador.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'rutaflow-prueba-paradas';

// ---------------------------------------------------------------- estado
let stops = loadStops(); // [{ id, title, subtitle, lat, lon }]
let lastRoute = null; // resultado del worker para el orden actual
let markers = [];

function loadStops() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveStops() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stops)); } catch { /* sin almacenamiento */ }
}

// ---------------------------------------------------------------- worker
const worker = new Worker(new URL('./motor-worker.js', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  if (data.progress) {
    const { done, total, downloadedMB } = data.progress;
    $('progress').textContent = `Descargando mapa de la zona: ${done}/${total} partes (${downloadedMB} MB en total)`;
    return;
  }
  pending.delete(data.id);
  if (data.ok) p.resolve(data.result);
  else p.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
};
worker.onerror = (e) => setStatus(`Error del motor: ${e.message || 'no se pudo cargar'}`, 'error');
function call(type, payload = {}) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject });
    worker.postMessage({ id, type, ...payload });
  });
}

function setStatus(text, kind = '') {
  const el = $('engine-status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

call('init')
  .then((info) => setStatus(`Motor listo · mapa ${new Date(info.createdAt).toLocaleDateString('es-ES')}`, 'ok'))
  .catch((err) => setStatus(err.message, 'error'));

// ---------------------------------------------------------------- mapa
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [-3.7, 40.2],
  zoom: 5,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');

map.on('load', () => {
  map.addSource('route', { type: 'geojson', data: emptyLine() });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#1e3a8a', 'line-width': 8, 'line-opacity': 0.5 },
  });
  map.addLayer({
    id: 'route', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#3b82f6', 'line-width': 5 },
  });
  renderAll();
  // Paradas guardadas de la vez anterior: se centra el mapa en ellas.
  fitToStops();
});

map.on('click', async (e) => {
  const { lat, lng } = e.lngLat;
  try {
    const found = await reverse(lat, lng);
    addStop({ title: found?.title || 'Punto del mapa', subtitle: found?.subtitle || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lon: lng });
  } catch {
    addStop({ title: 'Punto del mapa', subtitle: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lon: lng });
  }
});

const emptyLine = () => ({ type: 'FeatureCollection', features: [] });

// Polilínea de Valhalla (6 decimales).
function decodePolyline6(str) {
  const coords = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lon += delta;
    }
    coords.push([lon / 1e6, lat / 1e6]);
  }
  return coords;
}

function drawRoute(route) {
  const source = map.getSource('route');
  if (!source) return;
  if (!route) { source.setData(emptyLine()); return; }
  const coordinates = route.legs.flatMap((leg) => decodePolyline6(leg.shape));
  source.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} });
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  markers = stops.map((s, i) => {
    const el = document.createElement('div');
    el.className = `num${i === 0 ? ' start' : ''}`;
    el.textContent = i === 0 ? 'S' : String(i);
    return new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
  });
}

function fitToStops() {
  if (stops.length === 0) return;
  if (stops.length === 1) { map.flyTo({ center: [stops[0].lon, stops[0].lat], zoom: 14 }); return; }
  const b = new maplibregl.LngLatBounds();
  stops.forEach((s) => b.extend([s.lon, s.lat]));
  map.fitBounds(b, { padding: 50, maxZoom: 15 });
}

// ---------------------------------------------------------------- paradas
function addStop(stop) {
  stops.push({ id: crypto.randomUUID(), ...stop });
  lastRoute = null;
  saveStops();
  renderAll();
  fitToStops();
}

function removeStop(id) {
  stops = stops.filter((s) => s.id !== id);
  lastRoute = null;
  saveStops();
  renderAll();
}

function fmtTime(date) {
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(seconds) {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

function etas() {
  if (!lastRoute) return [];
  const perStop = Number($('stop-minutes').value || 0) * 60;
  let t = Date.now();
  const out = [new Date(t)];
  lastRoute.legs.forEach((leg, i) => {
    t += leg.seconds * 1000;
    out.push(new Date(t));
    if (i < stops.length - 1) t += perStop * 1000;
  });
  return out;
}

function renderStops() {
  const list = $('stops');
  list.innerHTML = '';
  const times = etas();
  stops.forEach((s, i) => {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = `num${i === 0 ? ' start' : ''}`;
    num.textContent = i === 0 ? 'S' : String(i);
    const text = document.createElement('div');
    text.className = 'stop-text';
    text.textContent = s.title;
    const small = document.createElement('small');
    small.textContent = i === 0 ? `Salida · ${s.subtitle || ''}` : s.subtitle || '';
    text.appendChild(small);
    li.append(num, text);
    if (times[i] && i > 0) {
      const eta = document.createElement('span');
      eta.className = 'eta';
      eta.textContent = fmtTime(times[i]);
      li.appendChild(eta);
    }
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.type = 'button';
    rm.setAttribute('aria-label', `Quitar ${s.title}`);
    rm.textContent = '×';
    rm.onclick = () => removeStop(s.id);
    li.appendChild(rm);
    list.appendChild(li);
  });
  $('count').textContent = stops.length ? `(${stops.length})` : '';
}

function googleLink() {
  // Google Maps admite pocas paradas en el enlace: se muestran las 10 primeras.
  const pts = stops.slice(0, 10).map((s) => `${s.lat},${s.lon}`);
  if (pts.length < 2) return '';
  const params = new URLSearchParams({
    api: '1',
    origin: pts[0],
    destination: pts[pts.length - 1],
    travelmode: 'driving',
  });
  if (pts.length > 2) params.set('waypoints', pts.slice(1, -1).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* sin voz */ }
}

function renderResult() {
  const box = $('result');
  if (!lastRoute) { box.hidden = true; return; }
  box.hidden = false;
  const times = etas();
  const end = times[times.length - 1];
  $('summary').textContent = `${lastRoute.summary.km.toFixed(1)} km · ${fmtDuration(lastRoute.summary.seconds)} conduciendo · fin aprox. ${end ? fmtTime(end) : '—'}`;
  const s = lastRoute.stats;
  $('stats').textContent =
    `Calculado en el móvil en ${(s.totalMillis / 1000).toFixed(1)} s` +
    (s.matrixMillis ? ` (tabla de tiempos ${(s.matrixMillis / 1000).toFixed(1)} s)` : '') +
    ` · mapa descargado en total: ${s.downloadedMB} MB · en memoria: ${s.memoryMB} MB`;
  const link = googleLink();
  $('google-link').hidden = !link;
  $('google-link').href = link || '#';

  const legs = $('legs');
  legs.innerHTML = '';
  lastRoute.legs.forEach((leg, i) => {
    const d = document.createElement('details');
    d.className = 'leg';
    if (i === 0) d.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `${i === 0 ? 'Salida' : `Parada ${i}`} → ${stops[i + 1] ? `Parada ${i + 1}: ${stops[i + 1].title}` : 'Salida'} · ${leg.km.toFixed(1)} km, ${fmtDuration(leg.seconds)}`;
    d.appendChild(sum);
    const ol = document.createElement('ol');
    leg.maneuvers.forEach((m) => {
      const li = document.createElement('li');
      li.textContent = `${m.text}${m.km > 0 ? ` (${m.km < 1 ? `${Math.round(m.km * 1000)} m` : `${m.km.toFixed(1)} km`})` : ''}`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary speak';
      b.textContent = '🔊';
      b.setAttribute('aria-label', 'Escuchar');
      b.onclick = () => speak(m.verbal);
      li.appendChild(b);
      ol.appendChild(li);
    });
    d.appendChild(ol);
    legs.appendChild(d);
  });
}

function renderAll() {
  renderStops();
  renderMarkers();
  renderResult();
  drawRoute(lastRoute);
}

// ---------------------------------------------------------------- cálculo
function options() {
  return {
    costing: $('costing').value,
    avoidTolls: $('avoid-tolls').checked,
    sameSide: $('same-side').checked,
  };
}

function points() {
  const pts = stops.map((s) => ({ lat: s.lat, lon: s.lon }));
  if ($('return').checked && pts.length > 1) pts.push(pts[0]);
  return pts;
}

function busy(on) {
  for (const id of ['optimize', 'calculate', 'clear', 'bulk-add']) $(id).disabled = on;
}

async function calculate(optimize) {
  if (stops.length < 2) { $('progress').textContent = 'Añade al menos la salida y una parada.'; return; }
  busy(true);
  const started = performance.now();
  let matrixMillis = 0;
  try {
    if (optimize && stops.length > 2) {
      $('progress').textContent = 'Calculando tiempos entre paradas…';
      const m = await call('matrix', { points: stops.map((s) => ({ lat: s.lat, lon: s.lon })), options: options() });
      matrixMillis = m.millis;
      const order = optimizeOrder(m.times, { returnToStart: $('return').checked });
      stops = order.map((i) => stops[i]);
      saveStops();
    }
    $('progress').textContent = 'Calculando la ruta…';
    const r = await call('route', { points: points(), options: options() });
    lastRoute = { ...r, stats: { ...r, matrixMillis, totalMillis: Math.round(performance.now() - started) } };
    $('progress').textContent = '';
    renderAll();
    fitToStops();
  } catch (err) {
    lastRoute = null;
    renderAll();
    $('progress').textContent = `No se pudo calcular: ${err.message}${err.code ? ` (código ${err.code})` : ''}`;
  } finally {
    busy(false);
  }
}

$('optimize').onclick = () => calculate(true);
$('calculate').onclick = () => calculate(false);
$('clear').onclick = () => {
  stops = [];
  lastRoute = null;
  saveStops();
  renderAll();
};
for (const id of ['costing', 'avoid-tolls', 'same-side', 'return']) {
  $(id).onchange = () => { if (lastRoute) calculate(false); };
}
$('stop-minutes').oninput = () => renderAll();

// ---------------------------------------------------------------- buscador
let searchAbort = null;
let searchTimer = 0;
let current = [];
const input = $('search');
const list = $('suggestions');

function closeSuggestions() { list.hidden = true; list.innerHTML = ''; current = []; }

input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    searchAbort?.abort();
    searchAbort = new AbortController();
    try {
      current = await suggest(input.value, searchAbort.signal);
    } catch (err) {
      if (err.name === 'AbortError') return;
      current = [];
    }
    list.innerHTML = '';
    current.forEach((s, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = s.title;
      const small = document.createElement('small');
      small.textContent = s.subtitle;
      li.appendChild(small);
      li.onclick = () => pick(i);
      list.appendChild(li);
    });
    list.hidden = current.length === 0;
  }, 250);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && current.length) { e.preventDefault(); pick(0); }
  if (e.key === 'Escape') closeSuggestions();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) closeSuggestions(); });

async function pick(i) {
  const s = current[i];
  closeSuggestions();
  input.value = '';
  try {
    const p = await resolve(s);
    addStop({ title: s.title, subtitle: s.subtitle, ...p });
  } catch (err) {
    $('progress').textContent = err.message;
  }
}

$('bulk-add').onclick = async () => {
  const lines = $('bulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  busy(true);
  const missing = [];
  for (const [k, line] of lines.entries()) {
    $('progress').textContent = `Buscando ${k + 1}/${lines.length}: ${line}`;
    try {
      const found = await geocodeText(line);
      if (found) stops.push({ id: crypto.randomUUID(), title: found.title, subtitle: found.subtitle, lat: found.lat, lon: found.lon });
      else missing.push(line);
    } catch {
      missing.push(line);
    }
  }
  lastRoute = null;
  saveStops();
  renderAll();
  fitToStops();
  $('bulk').value = missing.join('\n');
  $('progress').textContent = missing.length
    ? `No se encontraron ${missing.length} direcciones (se han dejado en el cuadro para corregirlas).`
    : `${lines.length} direcciones añadidas.`;
  busy(false);
};
