// Построение маршрутов.
// 1) /api/route — наш сервер с ключом 2ГИС (ключ не виден в браузере);
// 2) прямой запрос к 2ГИС с ключом из настроек демо (если сервера нет);
// 3) оценка по прямой — демо работает и без ключа.
import { fetch2gisRoute } from '../shared/dgis.js';
import { estimate } from './geo.js';

const KEY_STORAGE = 'vyezd-dgis-key';
const cache = new Map();
let lastSource = null;
const sourceListeners = new Set();

export function getUserKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}
export function setUserKey(k) {
  try {
    if (k) localStorage.setItem(KEY_STORAGE, k.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* хранилище недоступно */
  }
  cache.clear();
}

export function getRoutingSource() {
  return lastSource;
}
export function onRoutingSource(fn) {
  sourceListeners.add(fn);
  return () => sourceListeners.delete(fn);
}
function setSource(s, detail) {
  if (lastSource?.kind === s && lastSource?.detail === detail) return;
  lastSource = { kind: s, detail };
  sourceListeners.forEach((fn) => fn(lastSource));
}

function fallback(points) {
  let distance = 0;
  let duration = 0;
  for (let i = 1; i < points.length; i++) {
    const e = estimate(points[i - 1], points[i]);
    distance += e.distance;
    duration += e.duration;
  }
  return { coords: points, distance, duration, source: 'estimate' };
}

async function viaServer(points, userKey) {
  const res = await fetch('/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(userKey ? { 'x-dgis-key': userKey } : {}) },
    body: JSON.stringify({ points }),
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return { unavailable: true };
  const data = await res.json();
  if (res.status === 501) return { noKey: true };
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return { route: data };
}

export async function getRoute(points) {
  const pts = points.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  const ck = JSON.stringify(pts);
  if (cache.has(ck)) return cache.get(ck);

  const userKey = getUserKey();
  const p = (async () => {
    try {
      const r = await viaServer(pts, userKey);
      if (r.route) {
        setSource('2gis');
        return r.route;
      }
      if (r.unavailable && userKey) {
        const route = await fetch2gisRoute(pts, userKey);
        setSource('2gis');
        return { ...route, source: '2gis' };
      }
      setSource('estimate', 'нет ключа 2ГИС');
    } catch (e) {
      console.warn('[routing]', e);
      setSource('estimate', String(e.message || e));
    }
    return fallback(pts);
  })();
  cache.set(ck, p);
  const result = await p;
  if (result.source === 'estimate') cache.delete(ck); // повторим, когда появится ключ
  return result;
}

// Ссылка, открывающая маршрут в приложении/на сайте 2ГИС
export function dgisDirectionsLink(to, from) {
  const enc = (p) => `${p[1]}%2C${p[0]}`;
  return `https://2gis.kg/bishkek/directions/points/${from ? enc(from) : ''}%7C${enc(to)}`;
}
