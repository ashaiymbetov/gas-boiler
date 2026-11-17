// Логика эндпоинта /api/route — общая для Vercel и для dev-сервера Vite.
// Файлы с "_" в начале Vercel не превращает в отдельные эндпоинты.
import { fetch2gisRoute, validatePoints } from '../shared/dgis.js';

export async function handleRoute({ method, headers, body }, envKey) {
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  // Ключ берётся из переменной окружения сервера; если её нет —
  // из заголовка (ключ, вставленный в настройках демо).
  const key = envKey || headers['x-dgis-key'];
  if (!key) return { status: 501, body: { error: 'no_key' } };

  const points = body?.points;
  if (!validatePoints(points)) return { status: 400, body: { error: 'bad_points' } };

  try {
    const route = await fetch2gisRoute(points, key);
    return { status: 200, body: { ...route, source: '2gis' } };
  } catch (e) {
    return { status: 502, body: { error: 'upstream', message: String(e.message || e) } };
  }
}
