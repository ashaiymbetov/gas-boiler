// Общий код для работы с Routing API 2ГИС.
// Используется и на сервере (api/route.js), и в браузере (запасной прямой вызов).

export const DGIS_ROUTING_URL = 'https://routing.api.2gis.com/routing/7.0.0/global';

// Варианты тела запроса: сначала полный, затем упрощённые —
// на случай, если API не примет какой-то из параметров.
function requestBodies(points) {
  const pts = points.map(([lat, lon]) => ({ type: 'stop', lon, lat }));
  return [
    { points: pts, locale: 'ru', transport: 'driving', route_mode: 'fastest', traffic_mode: 'jam' },
    { points: pts, transport: 'driving' },
    { points: pts },
  ];
}

export function validatePoints(points) {
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.length <= 10 &&
    points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Math.abs(p[0]) <= 90 &&
        Math.abs(p[1]) <= 180,
    )
  );
}

// points: [[lat, lon], ...] -> { coords: [[lat, lon], ...], distance (м), duration (с) }
export async function fetch2gisRoute(points, key, fetchImpl = fetch) {
  let lastError = null;
  for (const body of requestBodies(points)) {
    const res = await fetchImpl(`${DGIS_ROUTING_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      const parsed = parse2gisRoute(data);
      if (parsed) return parsed;
      lastError = new Error(`2GIS: не удалось разобрать ответ (status=${data.status ?? '?'})`);
      continue;
    }
    lastError = new Error(`2GIS HTTP ${res.status}: ${data?.message || data?.error?.message || ''}`.trim());
    // Неверный ключ или лимит — упрощать запрос бессмысленно.
    if (res.status === 401 || res.status === 403 || res.status === 429) break;
  }
  throw lastError || new Error('2GIS: нет ответа');
}

function parseWkt(wkt) {
  // LINESTRING(lon lat, lon lat, ...) или MULTILINESTRING((...),(...))
  const inner = wkt.replace(/^[A-Z\s]+/i, '').replace(/[()]/g, ' ');
  const out = [];
  for (const pair of inner.split(',')) {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon]);
  }
  return out;
}

function collectSelections(node, out, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    for (const n of node) collectSelections(n, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'selection' && typeof v === 'string' && /LINESTRING/i.test(v)) out.push(v);
    else if (typeof v === 'object') collectSelections(v, out, depth + 1);
  }
}

export function parse2gisRoute(data) {
  const route = Array.isArray(data?.result) ? data.result[0] : null;
  if (!route) return null;

  const selections = [];
  for (const m of route.maneuvers || []) {
    const g = m?.outcoming_path?.geometry;
    if (Array.isArray(g)) g.forEach((x) => x?.selection && selections.push(x.selection));
    else if (g?.selection) selections.push(g.selection);
  }
  // Если структура отличается от ожидаемой — собираем все геометрии подряд.
  if (selections.length === 0) collectSelections(route, selections);

  const coords = [];
  for (const s of selections) {
    for (const p of parseWkt(s)) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
    }
  }
  if (coords.length < 2) return null;

  return {
    coords,
    distance: Number(route.total_distance) || null,
    duration: Number(route.total_duration) || null,
  };
}
