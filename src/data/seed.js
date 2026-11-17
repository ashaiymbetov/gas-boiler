// Генерация правдоподобных демо-данных: месяц истории + текущий день.
// Всё детерминировано от даты, чтобы демо выглядело одинаково у всех в течение дня.
import { LOCALITIES, ORDER_TYPES, BOILERS, MASTERS } from '../config.js';
import { haversine, jitter } from '../geo.js';

export const DATA_VERSION = 3;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayStart(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

const FIRST = ['Айгуль', 'Бектур', 'Елена', 'Жылдыз', 'Игорь', 'Канат', 'Мээрим', 'Ольга', 'Руслан', 'Самат',
  'Татьяна', 'Улан', 'Чынара', 'Эльмира', 'Алексей', 'Гульнара', 'Данияр', 'Наталья', 'Тимур', 'Асель'];
const LAST_M = ['Абдраев', 'Иванов', 'Касымов', 'Петров', 'Сыдыков', 'Ли', 'Жумабеков', 'Ким', 'Орозов', 'Смирнов'];
const LAST_F = ['Абдраева', 'Иванова', 'Касымова', 'Петрова', 'Сыдыкова', 'Ли', 'Жумабекова', 'Ким', 'Орозова', 'Смирнова'];
const FEMALE = new Set(['Айгуль', 'Елена', 'Жылдыз', 'Мээрим', 'Ольга', 'Татьяна', 'Чынара', 'Эльмира', 'Гульнара', 'Наталья', 'Асель']);
const SOURCES = [['whatsapp', 55], ['phone', 30], ['instagram', 15]];

function pickW(rnd, items, weight) {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = rnd() * total;
  for (const x of items) {
    r -= weight(x);
    if (r <= 0) return x;
  }
  return items[items.length - 1];
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (rnd, a, b) => Math.round(a + rnd() * (b - a));
const roundTo = (n, step) => Math.round(n / step) * step;

function makeClient(rnd, loc) {
  const first = pick(rnd, FIRST);
  const last = pick(rnd, FEMALE.has(first) ? LAST_F : LAST_M);
  const point = jitter([loc.lat, loc.lon], loc.r, rnd);
  const street = pick(rnd, loc.streets);
  const house = street.startsWith('мкр.') ? `д. ${randInt(rnd, 1, 60)}, кв. ${randInt(rnd, 1, 90)}` : randInt(rnd, 1, 180);
  return {
    name: `${first} ${last}`,
    phone: `+996 7•• ••• ${String(randInt(rnd, 10, 99))}`,
    locality: loc.id,
    address: `${loc.city ? '' : loc.name + ', '}${street}, ${house}`,
    lat: point[0],
    lon: point[1],
    boiler: pick(rnd, BOILERS),
  };
}

function makeOrder(rnd, num, client, typeKey, extra = {}) {
  const t = ORDER_TYPES[typeKey];
  return {
    id: `o${num}`,
    num,
    type: typeKey,
    problem: pick(rnd, t.problems),
    client: { name: client.name, phone: client.phone },
    locality: client.locality,
    address: client.address,
    lat: client.lat,
    lon: client.lon,
    boiler: client.boiler,
    source: pickW(rnd, SOURCES, (s) => s[1])[0],
    status: 'new',
    masterId: null,
    seq: 0,
    timeline: {},
    amount: null,
    rating: null,
    needsRepeat: false,
    repeatOf: null,
    report: null,
    ...extra,
  };
}

const locById = Object.fromEntries(LOCALITIES.map((l) => [l.id, l]));
const typeKeys = Object.keys(ORDER_TYPES);
const MIN = 60 * 1000;

function generateHistory(rnd, startNum) {
  const orders = [];
  const clients = [];
  let num = startNum;
  const pendingRepeats = []; // {day, client, cause}

  for (let d = -30; d <= -1; d++) {
    const base = dayStart(d);
    const dow = new Date(base).getDay();
    const count = dow === 0 ? randInt(rnd, 4, 6) : randInt(rnd, 10, 15);
    const dayOrders = [];

    // Повторные выезды, запланированные на этот день
    for (const rep of pendingRepeats.filter((r) => r.day === d)) {
      dayOrders.push(
        makeOrder(rnd, num++, rep.client, 'repair', {
          problem: 'Повторный выезд: неисправность вернулась',
          repeatOf: rep.orderId,
          warranty: true,
        }),
      );
    }

    for (let i = 0; i < count; i++) {
      let client;
      if (clients.length > 40 && rnd() < 0.15) client = pick(rnd, clients);
      else {
        client = makeClient(rnd, pickW(rnd, LOCALITIES, (l) => l.w));
        clients.push(client);
      }
      dayOrders.push(makeOrder(rnd, num++, client, pickW(rnd, typeKeys, (k) => ORDER_TYPES[k].w).toString()));
    }

    // Распределяем по мастерам: учитываем загрузку и близость к дому мастера
    let available = MASTERS.filter((m) => !(m.id === 'm6' && (dow === 1 || dow === 2)) && !(dow === 0 && rnd() < 0.5));
    if (available.length < 2) available = MASTERS.slice(0, 3); // в воскресенье дежурят хотя бы трое
    const perMaster = Object.fromEntries(available.map((m) => [m.id, []]));
    for (const o of dayOrders) {
      const m = pickW(rnd, available, (mm) => mm.profile.load / (1 + haversine(mm.home, [o.lat, o.lon]) / 8));
      perMaster[m.id].push(o);
    }

    for (const m of available) {
      const list = perMaster[m.id];
      let clock = 9 * 60 + randInt(rnd, 0, 20); // минуты от полуночи
      list.forEach((o, idx) => {
        const t = ORDER_TYPES[o.type];
        const winStart = Math.max(9 * 60, roundTo(clock, 60));
        o.window = [winStart, winStart + 120];
        const late = rnd() < m.profile.late;
        const arrive = late ? o.window[1] + randInt(rnd, 10, 55) : o.window[0] + randInt(rnd, -10, 95);
        const onsite = Math.round(randInt(rnd, t.onsite[0], t.onsite[1]) * m.profile.speed);
        const travel = randInt(rnd, 15, 45);
        const created = base - randInt(rnd, 60, 900) * MIN;
        o.status = 'done';
        o.masterId = m.id;
        o.seq = idx;
        o.date = todayStr(new Date(base));
        o.timeline = {
          createdAt: created,
          assignedAt: created + randInt(rnd, 3, 40) * MIN,
          enrouteAt: base + (arrive - travel) * MIN,
          onsiteAt: base + arrive * MIN,
          doneAt: base + (arrive + onsite) * MIN,
        };
        o.late = late;
        o.amount = o.warranty ? 0 : roundTo(randInt(rnd, t.price[0], t.price[1]), 100);
        o.rating = Math.max(3, Math.min(5, Math.round(m.profile.rating + (rnd() - 0.5) * 1.2)));
        if (!o.warranty && o.type !== 'install' && rnd() < m.profile.repeat) {
          o.needsRepeat = true;
          o.rating = Math.min(o.rating, 3);
          const repDay = d + randInt(rnd, 2, 8);
          if (repDay <= -1) {
            const c = { ...clients.find((c) => c.address === o.address && c.lat === o.lat) };
            pendingRepeats.push({ day: repDay, client: c.name ? c : { ...o.client, locality: o.locality, address: o.address, lat: o.lat, lon: o.lon, boiler: o.boiler }, orderId: o.id });
          }
        }
        clock = arrive + onsite + travel;
        orders.push(o);
      });
    }
  }
  return { orders, nextNum: num };
}

// Текущий день — заданный сценарий, удобный для демонстрации
const TODAY_PLAN = [
  { m: 'm1', loc: 'djal', type: 'service', status: 'done', win: [9, 11] },
  { m: 'm1', loc: 'asanbai', type: 'repair', status: 'onsite', win: [11, 13] },
  { m: 'm1', loc: 'vostok5', type: 'diag', status: 'assigned', win: [15, 17] },
  { m: 'm2', loc: 'archa', type: 'repair', status: 'done', win: [9, 11] },
  { m: 'm2', loc: 'akorgo', type: 'service', status: 'enroute', win: [11, 13] },
  { m: 'm2', loc: 'center', type: 'repair', status: 'assigned', win: [14, 16] },
  { m: 'm3', loc: 'alamedin', type: 'service', status: 'done', win: [9, 11] },
  // Порядок намеренно неудачный — чтобы показать оптимизацию маршрута
  { m: 'm3', loc: 'lebed', type: 'repair', status: 'assigned', win: [12, 17] },
  { m: 'm3', loc: 'tunguch', type: 'service', status: 'assigned', win: [12, 17] },
  { m: 'm3', loc: 'kalys', type: 'diag', status: 'assigned', win: [12, 17] },
  { m: 'm3', loc: 'karajygach', type: 'repair', status: 'assigned', win: [12, 17] },
  { m: 'm4', loc: 'kant', type: 'install', status: 'done', win: [9, 11] },
  { m: 'm4', loc: 'novopok', type: 'service', status: 'assigned', win: [15, 17] },
  { m: 'm5', loc: 'sokuluk', type: 'repair', status: 'done', win: [9, 11] },
  { m: null, loc: 'center', type: 'repair', status: 'new', win: [15, 17] },
  { m: null, loc: 'shopokov', type: 'service', status: 'new', win: [14, 18] },
  { m: null, loc: 'kokjar', type: 'diag', status: 'new', win: [16, 18] },
];

function generateToday(rnd, startNum) {
  const base = dayStart(0);
  let num = startNum;
  const orders = [];
  const seqByMaster = {};
  for (const p of TODAY_PLAN) {
    const client = makeClient(rnd, locById[p.loc]);
    const o = makeOrder(rnd, num++, client, p.type);
    const t = ORDER_TYPES[p.type];
    o.date = todayStr();
    o.window = [p.win[0] * 60, p.win[1] * 60];
    o.status = p.status;
    o.masterId = p.m;
    o.seq = p.m ? (seqByMaster[p.m] = (seqByMaster[p.m] ?? -1) + 1) : 0;
    const created = p.status === 'new' ? Date.now() - randInt(rnd, 5, 50) * MIN : base + randInt(rnd, 7 * 60, 8 * 60 + 40) * MIN;
    o.timeline = { createdAt: created };
    if (p.m) o.timeline.assignedAt = created + randInt(rnd, 3, 25) * MIN;
    if (p.status === 'done') {
      o.timeline.enrouteAt = base + (p.win[0] * 60 + 5) * MIN;
      o.timeline.onsiteAt = base + (p.win[0] * 60 + 35) * MIN;
      o.timeline.doneAt = base + (p.win[0] * 60 + 35 + randInt(rnd, t.onsite[0], t.onsite[1])) * MIN;
      o.amount = roundTo(randInt(rnd, t.price[0], t.price[1]), 100);
      o.rating = 5;
      o.report = { works: [ORDER_TYPES[p.type].label], note: '' , photos: [] };
    }
    if (p.status === 'onsite') {
      o.timeline.enrouteAt = base + (p.win[0] * 60 - 30) * MIN;
      o.timeline.onsiteAt = base + (p.win[0] * 60 + 10) * MIN;
    }
    if (p.status === 'enroute') o.timeline.enrouteAt = Date.now();
    orders.push(o);
  }
  return orders;
}

function makeEvents(orders, mastersById) {
  const ev = [];
  for (const o of orders) {
    const m = o.masterId ? mastersById[o.masterId] : null;
    const tl = o.timeline;
    ev.push({ t: tl.createdAt, kind: 'new', text: `Новая заявка №${o.num} · ${o.address}` });
    if (tl.assignedAt && m) ev.push({ t: tl.assignedAt, kind: 'assign', text: `№${o.num} назначена: ${m.short}` });
    if (tl.enrouteAt && m) ev.push({ t: tl.enrouteAt, kind: 'enroute', text: `${m.short} выехал на №${o.num}. Клиенту отправлено уведомление в WhatsApp` });
    if (tl.onsiteAt && m) ev.push({ t: tl.onsiteAt, kind: 'onsite', text: `${m.short} на объекте №${o.num}` });
    if (tl.doneAt && m) ev.push({ t: tl.doneAt, kind: 'done', text: `№${o.num} выполнена (${m.short}), ${o.amount?.toLocaleString('ru-RU')} сом` });
  }
  return ev.filter((e) => e.t <= Date.now() + 5 * 60 * MIN).sort((a, b) => b.t - a.t).slice(0, 40);
}

export function createSeed() {
  const date = todayStr();
  const rnd = mulberry32(Number(date.replace(/-/g, '')));
  const history = generateHistory(rnd, 1000);
  const today = generateToday(rnd, history.nextNum + 1);
  const orders = [...history.orders, ...today];
  const mastersById = Object.fromEntries(MASTERS.map((m) => [m.id, m]));

  const masters = {};
  for (const m of MASTERS) {
    const mine = today.filter((o) => o.masterId === m.id);
    const active = mine.find((o) => o.status === 'onsite' || o.status === 'enroute');
    const lastDone = mine.filter((o) => o.status === 'done').pop();
    let status = 'free';
    let pos = m.home;
    let travel = null;
    if (m.id === 'm6') status = 'off';
    if (lastDone) pos = [lastDone.lat, lastDone.lon];
    if (active?.status === 'onsite') {
      status = 'onsite';
      pos = [active.lat, active.lon];
    }
    if (active?.status === 'enroute') {
      status = 'enroute';
      travel = { orderId: active.id, from: pos, path: null, startedAt: null };
    }
    masters[m.id] = { status, pos, travel };
  }

  return {
    version: DATA_VERSION,
    seedDate: date,
    nextNum: Math.max(...orders.map((o) => o.num)) + 1,
    orders,
    masters,
    events: makeEvents(today, mastersById),
  };
}
