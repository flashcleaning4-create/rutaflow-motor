import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilePath, tilesInBox, tilesForPoints } from '../prueba/teselas.js';
import { optimizeOrder, tourCost } from '../prueba/optimizador.js';

test('rutas de teselas iguales que Valhalla', () => {
  // Ejemplo de la documentación de valhalla-wasm.
  assert.equal(tilePath(2, 781229), '2/000/781/229.gph');
  assert.equal(tilePath(0, 2), '0/000/002.gph');
  // Puerta del Sol (Madrid): nivel 2 → fila (40.4168+90)/0.25=521, col (-3.7038+180)/0.25=705
  const madrid = tilesInBox(2, { south: 40.4168, north: 40.4168, west: -3.7038, east: -3.7038 });
  assert.deepEqual(madrid, [tilePath(2, 521 * 1440 + 705)]);
});

test('zona pequeña: todas las calles; zona grande: solo cerca de las paradas', () => {
  const bcn = [{ lat: 41.39, lon: 2.16 }, { lat: 41.41, lon: 2.19 }];
  const small = tilesForPoints(bcn);
  assert.ok(small.some((p) => p.startsWith('2/')) && small.some((p) => p.startsWith('1/')) && small.some((p) => p.startsWith('0/')));
  const far = [{ lat: 41.39, lon: 2.16 }, { lat: 37.39, lon: -5.99 }]; // Barcelona → Sevilla
  const big = tilesForPoints(far);
  const level2 = big.filter((p) => p.startsWith('2/'));
  assert.ok(level2.length <= 8, `demasiadas teselas de calles: ${level2.length}`);
  const full = tilesForPoints(far, { full: true }).filter((p) => p.startsWith('2/'));
  assert.ok(full.length > 100);
  const onlyAvailable = tilesForPoints(bcn, { available: new Set([small[0]]) });
  assert.deepEqual(onlyAvailable, [small[0]]);
});

function randomMatrix(n, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pts = Array.from({ length: n }, () => [rnd() * 10000, rnd() * 10000]);
  return pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * (1 + rnd() * 0.2)));
}

test('optimizador: empieza en la salida, visita todas una vez y mejora el orden', () => {
  for (const n of [3, 8, 40, 95]) {
    const cost = randomMatrix(n, n * 7);
    const order = optimizeOrder(cost, { maxMillis: 4000 });
    assert.equal(order[0], 0);
    assert.equal(new Set(order).size, n);
    const naive = [...Array(n).keys()];
    assert.ok(tourCost(order, cost, false) <= tourCost(naive, cost, false));
  }
});

test('optimizador: encuentra el óptimo en un caso pequeño', () => {
  // Puntos en una línea, desordenados: el óptimo es ir en orden de posición.
  const pos = [0, 5, 1, 4, 2, 3];
  const cost = pos.map((a) => pos.map((b) => Math.abs(a - b)));
  const order = optimizeOrder(cost);
  assert.deepEqual(order.map((i) => pos[i]), [0, 1, 2, 3, 4, 5]);
  // Calles de un solo sentido: no hay camino de 1 a 2 (Infinity).
  const c2 = [[0, 1, 5], [1, 0, Infinity], [5, 1, 0]];
  assert.deepEqual(optimizeOrder(c2), [0, 2, 1]);
});

test('optimizador: rápido con 95 paradas', () => {
  const cost = randomMatrix(95, 3);
  const t = Date.now();
  optimizeOrder(cost, { maxMillis: 3000 });
  assert.ok(Date.now() - t < 3500);
});

import { parseAddress, scoreCandidate, titleCase } from '../prueba/geocoder.js';

test('direcciones escritas a mano: calle, número y municipio', () => {
  assert.deepEqual(parseAddress('Carrer de Balmes 40, Barcelona'), { street: 'balmes', number: 40, place: 'barcelona', postal: null });
  assert.deepEqual(parseAddress('calle balmes 40 barcelona'), { street: 'balmes', number: 40, place: 'barcelona', postal: null });
  assert.deepEqual(parseAddress('C/ Gran de Gràcia, 120, 08012 Barcelona'), { street: 'gran de gracia', number: 120, place: 'barcelona', postal: '08012' });
  assert.equal(parseAddress("Carrer d'Aragó 255, Barcelona").street, 'arago');
  assert.equal(parseAddress('Calle 1 de Mayo 3, Murcia').street, '1 de mayo');
});

test('se prefiere el municipio escrito y el mismo lado de la calle', () => {
  // Respuesta real de CartoCiudad para «Carrer de Balmes 40, Barcelona».
  const wanted = parseAddress('Carrer de Balmes 40, Barcelona');
  const palma = { address: 'CALLE JAUME BALMÉS 41, Palma', muni: 'Palma', poblacion: 'Palma', portalNumber: 41 };
  const bcn41 = { address: 'CALLE BALMES 41, Barcelona', muni: 'Barcelona', poblacion: 'Barcelona', portalNumber: 41 };
  const bcn42 = { address: 'CALLE BALMES 42, Barcelona', muni: 'Barcelona', poblacion: 'Barcelona', portalNumber: 42 };
  assert.ok(scoreCandidate(bcn42, wanted) > scoreCandidate(bcn41, wanted));
  assert.ok(scoreCandidate(bcn41, wanted) > scoreCandidate(palma, wanted));
  assert.equal(titleCase("CALLE D'ARAGO 255"), "Calle d'Arago 255");
});
