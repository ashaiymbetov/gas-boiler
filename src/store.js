// Простое хранилище состояния демо.
// Хранится в localStorage и синхронизируется между вкладками:
// открой диспетчера и мастера в двух окнах — изменения видны сразу.
import { useSyncExternalStore, useEffect, useState } from 'react';
import { createSeed, DATA_VERSION, todayStr } from './data/seed.js';
import { MASTERS, ORDER_TYPES, LOCALITIES, SIM_SPEEDUP } from './config.js';
import { getRoute } from './routing.js';
import { jitter, optimizeOrder, pointAlong } from './geo.js';

const KEY = 'vyezd-demo-state';
const listeners = new Set();
const mastersById = Object.fromEntries(MASTERS.map((m) => [m.id, m]));

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.version === DATA_VERSION && s.seedDate === todayStr()) return s;
  } catch {
    /* повреждённые данные — создаём заново */
  }
  return createSeed();
}

let state = load();
persist();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[store] не удалось сохранить', e);
  }
}
function emit() {
  listeners.forEach((fn) => fn());
}
function update(fn) {
  const draft = structuredClone(state);
  fn(draft);
  state = draft;
  persist();
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      try {
        state = JSON.parse(e.newValue);
        emit();
      } catch {
        /* игнорируем */
      }
    }
  });
}

export function getState() {
  return state;
}
export function useStore() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

// Тикающее «сейчас» для анимации движения мастеров
export function useNow(ms = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---------- Селекторы ----------

export const master = (id) => mastersById[id];

export function todayOrders(s = state) {
  const d = todayStr();
  return s.orders.filter((o) => o.date === d);
}

export function masterQueue(s, masterId) {
  return todayOrders(s)
    .filter((o) => o.masterId === masterId && o.status !== 'cancelled')
    .sort((a, b) => a.seq - b.seq);
}

export function masterPosition(s, masterId, now = Date.now()) {
  const m = s.masters[masterId];
  if (!m) return null;
  const tr = m.travel;
  if (m.status === 'enroute' && tr?.path && tr.startedAt) {
    const t = Math.min(1, (now - tr.startedAt) / tr.simMs);
    return pointAlong(tr.path, t);
  }
  if (m.status === 'enroute' && tr?.from) return tr.from;
  return m.pos;
}

export function travelProgress(s, masterId, now = Date.now()) {
  const tr = s.masters[masterId]?.travel;
  if (!tr?.startedAt) return null;
  const t = Math.min(1, (now - tr.startedAt) / tr.simMs);
  return { t, etaSec: Math.max(0, tr.duration * (1 - t)), distance: tr.distance, source: tr.source };
}

// ---------- Действия ----------

function log(d, kind, text) {
  d.events.unshift({ t: Date.now(), kind, text });
  d.events = d.events.slice(0, 60);
}

export function resetDemo() {
  state = createSeed();
  persist();
  emit();
  ensureTravelPaths();
}

export function assignOrder(orderId, masterId) {
  update((d) => {
    const o = d.orders.find((x) => x.id === orderId);
    if (!o) return;
    const queue = d.orders.filter((x) => x.date === o.date && x.masterId === masterId && x.id !== o.id);
    o.masterId = masterId;
    o.status = 'assigned';
    o.seq = queue.reduce((mx, x) => Math.max(mx, x.seq), -1) + 1;
    o.timeline.assignedAt = Date.now();
    log(d, 'assign', `№${o.num} назначена: ${mastersById[masterId].short}`);
  });
}

export function unassignOrder(orderId) {
  update((d) => {
    const o = d.orders.find((x) => x.id === orderId);
    if (!o || o.status !== 'assigned') return;
    log(d, 'assign', `№${o.num} снята с мастера ${mastersById[o.masterId].short}`);
    o.masterId = null;
    o.status = 'new';
    delete o.timeline.assignedAt;
  });
}

export function createOrder({ clientName, phone, localityId, address, lat, lon, type, problem, boiler, window, source }) {
  let id;
  update((d) => {
    const num = d.nextNum++;
    id = `o${num}`;
    d.orders.push({
      id,
      num,
      type,
      problem: problem || ORDER_TYPES[type].problems[0],
      client: { name: clientName || 'Клиент', phone: phone || '+996 ••• ••• •••' },
      locality: localityId,
      address,
      lat,
      lon,
      boiler: boiler || '',
      source: source || 'phone',
      status: 'new',
      masterId: null,
      seq: 0,
      date: todayStr(),
      window,
      timeline: { createdAt: Date.now() },
      amount: null,
      rating: null,
      needsRepeat: false,
      repeatOf: null,
      report: null,
    });
    log(d, 'new', `Новая заявка №${num} · ${address}`);
  });
  return id;
}

const INCOMING = [
  { name: 'Гульнара Сыдыкова', loc: 'archa', type: 'repair', problem: 'Котёл не включается, ошибка E10', boiler: 'Navien Deluxe 24K' },
  { name: 'Алексей Петров', loc: 'kant', type: 'repair', problem: 'Падает давление в системе', boiler: 'Baxi ECO-4s 24F' },
  { name: 'Мээрим Касымова', loc: 'djal', type: 'service', problem: 'Плановое ТО к отопительному сезону', boiler: 'Ariston Clas X 24' },
  { name: 'Тимур Орозов', loc: 'sokuluk', type: 'diag', problem: 'Высокий расход газа', boiler: 'Protherm Пантера 25' },
  { name: 'Наталья Ким', loc: 'lebed', type: 'repair', problem: 'Не греет воду для ГВС', boiler: 'Bosch Gaz 6000 W' },
];

// Имитация входящей заявки из WhatsApp — удобно для видео
export function simulateIncoming() {
  const i = state.nextNum % INCOMING.length;
  const t = INCOMING[i];
  const loc = LOCALITIES.find((l) => l.id === t.loc);
  const p = jitter([loc.lat, loc.lon], loc.r * 0.8, Math.random);
  const street = loc.streets[Math.floor(Math.random() * loc.streets.length)];
  const h = new Date().getHours();
  const start = Math.min(Math.max(h + 1, 9), 17);
  return createOrder({
    clientName: t.name,
    phone: `+996 7•• ••• ${10 + Math.floor(Math.random() * 89)}`,
    localityId: loc.id,
    address: `${loc.city ? '' : loc.name + ', '}${street}, ${1 + Math.floor(Math.random() * 150)}`,
    lat: p[0],
    lon: p[1],
    type: t.type,
    problem: t.problem,
    boiler: t.boiler,
    window: [start * 60, (start + 2) * 60],
    source: 'whatsapp',
  });
}

async function buildTravel(from, to) {
  const route = await getRoute([from, to]);
  const duration = route.duration || 600;
  const simMs = Math.min(60000, Math.max(15000, (duration * 1000) / SIM_SPEEDUP));
  return { path: route.coords, distance: route.distance, duration, simMs, source: route.source, startedAt: Date.now() };
}

export async function startTravel(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o?.masterId) return;
  const mid = o.masterId;
  const from = masterPosition(state, mid);
  const travel = await buildTravel(from, [o.lat, o.lon]);
  update((d) => {
    const oo = d.orders.find((x) => x.id === orderId);
    const m = d.masters[mid];
    m.status = 'enroute';
    m.travel = { orderId, from, ...travel };
    oo.status = 'enroute';
    oo.timeline.enrouteAt = Date.now();
    const mins = Math.max(5, Math.round(travel.duration / 60));
    log(d, 'enroute', `${mastersById[mid].short} выехал на №${oo.num}`);
    log(d, 'notify', `WhatsApp клиенту (${oo.client.name}): «Мастер ${mastersById[mid].short} выехал, будет примерно через ${mins} мин»`);
  });
}

// Для мастеров, которые «в пути» при загрузке демо, достраиваем маршрут
export async function ensureTravelPaths() {
  for (const [mid, m] of Object.entries(state.masters)) {
    if (m.status !== 'enroute' || m.travel?.path) continue;
    const o = state.orders.find((x) => x.id === m.travel?.orderId);
    if (!o) continue;
    const travel = await buildTravel(m.travel.from || m.pos, [o.lat, o.lon]);
    update((d) => {
      d.masters[mid].travel = { ...d.masters[mid].travel, ...travel };
    });
  }
}

export function arrive(orderId) {
  update((d) => {
    const o = d.orders.find((x) => x.id === orderId);
    if (!o) return;
    const m = d.masters[o.masterId];
    m.status = 'onsite';
    m.pos = [o.lat, o.lon];
    m.travel = null;
    o.status = 'onsite';
    o.timeline.onsiteAt = Date.now();
    const end = new Date();
    o.late = end.getHours() * 60 + end.getMinutes() > o.window[1];
    log(d, 'onsite', `${mastersById[o.masterId].short} на объекте №${o.num}`);
  });
}

export function completeOrder(orderId, { amount, works, note, photos, needsRepeat }) {
  update((d) => {
    const o = d.orders.find((x) => x.id === orderId);
    if (!o) return;
    const m = d.masters[o.masterId];
    m.status = 'free';
    m.pos = [o.lat, o.lon];
    o.status = 'done';
    o.timeline.doneAt = Date.now();
    o.amount = amount;
    o.needsRepeat = !!needsRepeat;
    o.report = { works, note, photos };
    log(d, 'done', `№${o.num} выполнена (${mastersById[o.masterId].short}), ${Number(amount).toLocaleString('ru-RU')} сом`);
    log(d, 'notify', `WhatsApp клиенту (${o.client.name}): акт работ и просьба оценить мастера`);
  });
}

// Оптимизация порядка оставшихся заявок мастера
export function planOptimization(s, masterId) {
  const queue = masterQueue(s, masterId).filter((o) => o.status === 'assigned');
  const start = masterPosition(s, masterId);
  const res = optimizeOrder(start, queue.map((o) => [o.lat, o.lon]));
  return { ids: res.order.map((i) => queue[i].id), beforeKm: res.before * 1.35, afterKm: (res.after ?? res.before) * 1.35, changed: res.order.some((v, i) => v !== i) };
}

export function applyOrder(masterId, ids) {
  update((d) => {
    const active = d.orders.filter((o) => o.masterId === masterId && o.date === todayStr() && o.status !== 'assigned');
    let seq = active.reduce((mx, o) => Math.max(mx, o.seq), -1) + 1;
    for (const id of ids) {
      const o = d.orders.find((x) => x.id === id);
      if (o) o.seq = seq++;
    }
    log(d, 'route', `Маршрут ${mastersById[masterId].short} на сегодня перестроен`);
  });
}
