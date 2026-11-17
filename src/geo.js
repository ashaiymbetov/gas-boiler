import { AVG_SPEED_KMH } from './config.js';

const R = 6371; // км

export function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Оценка по прямой: дороги в среднем длиннее прямой на ~35%
export function estimate(a, b) {
  const km = haversine(a, b) * 1.35;
  return { distance: km * 1000, duration: (km / AVG_SPEED_KMH) * 3600 };
}

export function pathLengthKm(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += haversine(path[i - 1], path[i]);
  return s;
}

// Точка на ломаной при доле пути t ∈ [0, 1]
export function pointAlong(path, t) {
  if (!path || path.length === 0) return null;
  if (path.length === 1 || t <= 0) return path[0];
  if (t >= 1) return path[path.length - 1];
  const total = pathLengthKm(path);
  let target = total * t;
  for (let i = 1; i < path.length; i++) {
    const seg = haversine(path[i - 1], path[i]);
    if (target <= seg) {
      const k = seg === 0 ? 0 : target / seg;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k];
    }
    target -= seg;
  }
  return path[path.length - 1];
}

// Случайная точка в радиусе r км
export function jitter(center, rKm, rnd) {
  const ang = rnd() * Math.PI * 2;
  const d = Math.sqrt(rnd()) * rKm;
  const dLat = (d / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos((center[0] * Math.PI) / 180);
  return [+(center[0] + dLat * Math.sin(ang)).toFixed(6), +(center[1] + dLon * Math.cos(ang)).toFixed(6)];
}

function routeLen(start, pts, order) {
  let s = 0;
  let prev = start;
  for (const i of order) {
    s += haversine(prev, pts[i]);
    prev = pts[i];
  }
  return s;
}

// Порядок объезда точек от start: «ближайший сосед» + улучшение 2-opt.
// Для 5–15 заявок в день этого более чем достаточно.
// В пилоте можно заменить на TSP API 2ГИС, учитывающий пробки.
export function optimizeOrder(start, pts) {
  const n = pts.length;
  if (n < 2) return { order: pts.map((_, i) => i), before: routeLen(start, pts, pts.map((_, i) => i)) };
  const initial = pts.map((_, i) => i);
  const before = routeLen(start, pts, initial);

  const left = new Set(initial);
  let order = [];
  let cur = start;
  while (left.size) {
    let best = null;
    let bestD = Infinity;
    for (const i of left) {
      const d = haversine(cur, pts[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
    cur = pts[best];
  }

  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1));
        if (routeLen(start, pts, cand) + 1e-9 < routeLen(start, pts, order)) {
          order = cand;
          improved = true;
        }
      }
    }
  }
  return { order, before, after: routeLen(start, pts, order) };
}
