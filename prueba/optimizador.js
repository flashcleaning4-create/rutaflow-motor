// Ordena las paradas con una tabla de tiempos reales (segundos) entre ellas.
// cost[i][j] = tiempo de i a j (puede no ser simétrico: calles de un sentido).
// El punto 0 es la salida y no se mueve. Con `returnToStart`, se vuelve al 0.
// Vecino más cercano + mejoras 2-opt y or-opt hasta que no mejore.
// Sin dependencias: se puede probar con Node.

function tourCost(order, cost, returnToStart) {
  let total = 0;
  for (let k = 0; k < order.length - 1; k++) total += cost[order[k]][order[k + 1]];
  if (returnToStart && order.length > 1) total += cost[order[order.length - 1]][order[0]];
  return total;
}

function nearestNeighbour(n, cost) {
  const order = [0];
  const used = new Array(n).fill(false);
  used[0] = true;
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let best = -1;
    for (let j = 1; j < n; j++) {
      if (!used[j] && (best === -1 || cost[last][j] < cost[last][best])) best = j;
    }
    used[best] = true;
    order.push(best);
  }
  return order;
}

/**
 * @param {number[][]} cost  matriz n×n (Infinity si no hay camino)
 * @param {{returnToStart?: boolean, maxMillis?: number}} options
 * @returns {number[]} índices en orden de visita, empezando por 0
 */
export function optimizeOrder(cost, { returnToStart = false, maxMillis = 3000 } = {}) {
  const n = cost.length;
  if (n <= 2) return [...Array(n).keys()];
  // Sin camino conocido: se penaliza mucho, pero se puede comparar.
  const c = cost.map((row) => row.map((v) => (Number.isFinite(v) ? v : 1e9)));
  let order = nearestNeighbour(n, c);
  let best = tourCost(order, c, returnToStart);
  const deadline = Date.now() + maxMillis;

  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;

    // 2-opt: invertir un tramo (se recalcula el coste completo porque la
    // tabla no es simétrica).
    for (let i = 1; i < n - 1 && !improved; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        const value = tourCost(candidate, c, returnToStart);
        if (value < best - 1e-6) {
          order = candidate;
          best = value;
          improved = true;
          break;
        }
      }
    }
    if (improved) continue;

    // or-opt: mover 1, 2 o 3 paradas seguidas a otra posición.
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 1; i + len <= n && !improved; i++) {
        const segment = order.slice(i, i + len);
        const rest = order.slice(0, i).concat(order.slice(i + len));
        for (let k = 1; k <= rest.length; k++) {
          if (k === i) continue;
          const candidate = rest.slice(0, k).concat(segment, rest.slice(k));
          const value = tourCost(candidate, c, returnToStart);
          if (value < best - 1e-6) {
            order = candidate;
            best = value;
            improved = true;
            break;
          }
        }
      }
    }
  }
  return order;
}

export { tourCost };
