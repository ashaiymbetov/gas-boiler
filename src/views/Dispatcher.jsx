import { useEffect, useMemo, useState } from 'react';
import MapView, { orderPinHtml, masterPinHtml } from '../components/MapView.jsx';
import { StatusBadge, Empty } from '../components/ui.jsx';
import Master from './Master.jsx';
import {
  useStore, useNow, todayOrders, masterQueue, masterPosition, travelProgress, master as masterInfo,
  assignOrder, unassignOrder, createOrder, simulateIncoming, planOptimization, applyOrder,
} from '../store.js';
import { MASTERS, STATUS, MASTER_STATUS, ORDER_TYPES, LOCALITIES, BOILERS } from '../config.js';
import { estimate } from '../geo.js';
import { getRoute } from '../routing.js';
import { km, mins, windowLabel, clock, initials, money, SOURCE_LABEL } from '../format.js';

const FILTERS = [
  ['active', 'В работе'],
  ['new', 'Новые'],
  ['done', 'Выполнены'],
  ['all', 'Все'],
];

export default function Dispatcher({ withPhone = false }) {
  const s = useStore();
  const now = useNow(400);
  const [tab, setTab] = useState('orders');
  const [filter, setFilter] = useState('active');
  const [selOrder, setSelOrder] = useState(null);
  const [selMaster, setSelMaster] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [routes, setRoutes] = useState({}); // id -> route
  const [form, setForm] = useState(null); // черновик новой заявки
  const [fit, setFit] = useState(null);
  const [phoneMaster, setPhoneMaster] = useState('m5');
  const [plan, setPlan] = useState(null);

  const orders = todayOrders(s);
  const order = orders.find((o) => o.id === selOrder) || null;

  const counts = useMemo(() => {
    const c = { new: 0, active: 0, done: 0, all: orders.length };
    for (const o of orders) {
      if (o.status === 'new') c.new++;
      if (['new', 'assigned', 'enroute', 'onsite'].includes(o.status)) c.active++;
      if (o.status === 'done') c.done++;
    }
    return c;
  }, [orders]);

  const list = orders
    .filter((o) =>
      filter === 'all' ? true : filter === 'active' ? o.status !== 'done' && o.status !== 'cancelled' : o.status === filter,
    )
    .sort((a, b) => (b.status === 'new') - (a.status === 'new') || a.window[0] - b.window[0] || a.num - b.num);

  // Подбор мастера: оценка по прямой + очередь
  const candidates = useMemo(() => {
    if (!order || order.status !== 'new') return [];
    return MASTERS.filter((m) => s.masters[m.id].status !== 'off')
      .map((m) => {
        const pos = masterPosition(s, m.id);
        const queue = masterQueue(s, m.id).filter((o) => o.status !== 'done');
        const e = estimate(pos, [order.lat, order.lon]);
        return { m, pos, queue: queue.length, ...e, score: e.duration / 60 + queue.length * 35 };
      })
      .sort((a, b) => a.score - b.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status, s.masters]);

  useEffect(() => {
    setCandidate(candidates[0]?.m.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status]);

  // Маршрут кандидата/назначенного мастера до выбранной заявки
  const routeMasterId = order ? (order.status === 'new' ? candidate : order.status === 'assigned' ? order.masterId : null) : null;
  useEffect(() => {
    if (!order || !routeMasterId) return;
    const id = `pre:${routeMasterId}:${order.id}`;
    if (routes[id]) return;
    let alive = true;
    getRoute([masterPosition(s, routeMasterId), [order.lat, order.lon]]).then((r) => alive && setRoutes((x) => ({ ...x, [id]: r })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, routeMasterId]);

  // Маршрут дня выбранного мастера
  const dayPoints = useMemo(() => {
    if (!selMaster) return null;
    const q = masterQueue(s, selMaster).filter((o) => o.status === 'assigned' || o.status === 'enroute' || o.status === 'onsite');
    return [masterPosition(s, selMaster), ...q.map((o) => [o.lat, o.lon])];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMaster, s]);
  const dayKey = dayPoints ? `day:${selMaster}:${JSON.stringify(dayPoints.slice(1))}` : null;
  useEffect(() => {
    if (!dayPoints || dayPoints.length < 2 || routes[dayKey]) return;
    let alive = true;
    getRoute(dayPoints.slice(0, 10)).then((r) => alive && setRoutes((x) => ({ ...x, [dayKey]: r })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  useEffect(() => setPlan(null), [selMaster]);

  // ---------- Карта ----------
  const markers = [];
  const polylines = [];
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const highlight = selMaster ? o.masterId === selMaster : true;
    if (o.status === 'done' && !(selOrder === o.id) && filter !== 'done' && filter !== 'all') continue;
    const qIdx = selMaster && o.masterId === selMaster && o.status !== 'done'
      ? masterQueue(s, selMaster).filter((x) => x.status !== 'done').findIndex((x) => x.id === o.id) + 1
      : null;
    markers.push({
      id: o.id,
      lat: o.lat,
      lon: o.lon,
      html: orderPinHtml(STATUS[o.status].color, qIdx ? `${qIdx}` : `${o.num}`, { selected: o.id === selOrder, dim: !highlight }),
      size: [44, 30],
      anchor: [22, 30],
      z: o.id === selOrder ? 1000 : o.status === 'new' ? 500 : 0,
      title: `№${o.num} · ${o.address}`,
      onClick: () => {
        setSelOrder(o.id);
        setTab('orders');
        setForm(null);
      },
    });
  }
  for (const m of MASTERS) {
    const st = s.masters[m.id];
    if (st.status === 'off') continue;
    const pos = masterPosition(s, m.id, now);
    markers.push({
      id: `m:${m.id}`,
      lat: pos[0],
      lon: pos[1],
      html: masterPinHtml(MASTER_STATUS[st.status].color, initials(m.name), { selected: selMaster === m.id || candidate === m.id && order?.status === 'new', moving: st.status === 'enroute' }),
      size: [36, 36],
      anchor: st.status === 'onsite' ? [2, 6] : [18, 18], // на объекте — сдвигаем, чтобы не закрывать заявку
      z: 2000,
      title: `${m.name} — ${MASTER_STATUS[st.status].label}`,
      onClick: () => {
        setSelMaster(m.id);
        setTab('masters');
        setSelOrder(null);
      },
    });
    if (st.status === 'enroute' && st.travel?.path) {
      polylines.push({ id: `tr:${m.id}`, coords: st.travel.path, color: MASTER_STATUS.enroute.color, weight: 4, dash: st.travel.source === 'estimate' ? '6 8' : undefined });
    }
  }
  if (order && routeMasterId) {
    const r = routes[`pre:${routeMasterId}:${order.id}`];
    if (r) polylines.push({ id: 'pre', coords: r.coords, color: STATUS.assigned.color, weight: 5, dash: r.source === 'estimate' ? '8 8' : undefined });
  }
  if (selMaster && routes[dayKey]) {
    const r = routes[dayKey];
    polylines.push({ id: 'day', coords: r.coords, color: STATUS.assigned.color, weight: 5, dash: r.source === 'estimate' ? '8 8' : undefined });
  }
  if (form?.lat) {
    markers.push({ id: 'draft', lat: form.lat, lon: form.lon, html: orderPinHtml(STATUS.new.color, 'Новая', { selected: true }), size: [56, 30], anchor: [28, 30], z: 3000 });
  }

  // Подгоняем карту при выборе
  useEffect(() => {
    if (order) {
      const pts = [[order.lat, order.lon]];
      const mid = routeMasterId || (['enroute', 'onsite'].includes(order.status) ? order.masterId : null);
      if (mid) pts.push(masterPosition(s, mid));
      if (order.status === 'enroute' && s.masters[order.masterId]?.travel?.path) pts.push(...s.masters[order.masterId].travel.path);
      setFit({ key: `o:${order.id}:${mid}:${order.status}`, points: pts });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, routeMasterId, order?.status]);
  useEffect(() => {
    if (selMaster && dayPoints) setFit({ key: `m:${selMaster}`, points: dayPoints });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMaster]);

  const onMapClick = (p) => {
    if (form) setForm((f) => ({ ...f, lat: +p[0].toFixed(6), lon: +p[1].toFixed(6) }));
  };

  return (
    <div className={`dispatch ${withPhone ? 'dispatch--phone' : ''}`}>
      <aside className="panel">
        <div className="tabs" role="tablist">
          {[
            ['orders', `Заявки · ${counts.active}`],
            ['masters', 'Мастера'],
            ['log', 'Журнал'],
          ].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setForm(null); }}>
              {l}
            </button>
          ))}
        </div>

        <div className="panel-body">
          {tab === 'orders' && form && (
            <NewOrderForm form={form} setForm={setForm} onCreated={(id) => { setForm(null); setSelOrder(id); }} />
          )}

          {tab === 'orders' && !form && !order && (
            <>
              <div className="row gap">
                <button className="btn primary" onClick={() => { setForm({ type: 'repair', localityId: 'center', lat: LOCALITIES[0].lat, lon: LOCALITIES[0].lon, window: [15 * 60, 17 * 60] }); setSelMaster(null); }}>
                  + Новая заявка
                </button>
                <button className="btn" onClick={() => { const id = simulateIncoming(); setSelOrder(id); setSelMaster(null); }} title="Имитирует заявку, пришедшую из WhatsApp">
                  Входящая из WhatsApp
                </button>
              </div>
              <div className="chips">
                {FILTERS.map(([k, l]) => (
                  <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                    {l} <b>{counts[k]}</b>
                  </button>
                ))}
              </div>
              <ul className="olist">
                {list.map((o) => (
                  <li key={o.id}>
                    <button className="ocard" onClick={() => { setSelOrder(o.id); setSelMaster(null); }}>
                      <div className="ocard-top">
                        <StatusBadge status={o.status} />
                        <span className="muted">№{o.num} · {windowLabel(o.window)}</span>
                      </div>
                      <div className="ocard-addr">{o.address}</div>
                      <div className="ocard-meta">
                        {ORDER_TYPES[o.type].label}
                        {o.masterId ? ` · ${masterInfo(o.masterId).short}` : ''}
                      </div>
                    </button>
                  </li>
                ))}
                {list.length === 0 && <Empty>Нет заявок</Empty>}
              </ul>
            </>
          )}

          {tab === 'orders' && !form && order && (
            <OrderDetail
              s={s}
              now={now}
              order={order}
              candidates={candidates}
              candidate={candidate}
              setCandidate={setCandidate}
              route={routes[`pre:${routeMasterId}:${order.id}`]}
              onBack={() => setSelOrder(null)}
              onShowMaster={(id) => { setSelMaster(id); setSelOrder(null); setTab('masters'); }}
            />
          )}

          {tab === 'masters' && (
            <MastersTab s={s} now={now} selMaster={selMaster} setSelMaster={setSelMaster} dayRoute={routes[dayKey]} plan={plan} setPlan={setPlan}
              onOrder={(id) => { setSelOrder(id); setTab('orders'); setSelMaster(null); }} />
          )}

          {tab === 'log' && (
            <ul className="log">
              {s.events.map((e, i) => (
                <li key={i} className={`log-${e.kind}`}>
                  <time>{clock(e.t)}</time>
                  <span>{e.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="map-wrap">
        <MapView markers={markers} polylines={polylines} fit={fit} onMapClick={onMapClick} cursor={form ? 'crosshair' : undefined} />
        {form && <div className="map-hint">Кликните на карте, чтобы указать точку заявки</div>}
        <Legend />
      </section>

      {withPhone && (
        <section className="phone-col">
          <label className="phone-pick">
            Телефон мастера:
            <select value={phoneMaster} onChange={(e) => setPhoneMaster(e.target.value)}>
              {MASTERS.filter((m) => s.masters[m.id].status !== 'off').map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <div className="phone">
            <div className="phone-notch" />
            <div className="phone-screen">
              <Master masterId={phoneMaster} embedded />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      {['new', 'assigned', 'enroute', 'onsite'].map((k) => (
        <span key={k}><i style={{ background: STATUS[k].color }} />{STATUS[k].label}</span>
      ))}
      <span><i className="round" style={{ background: '#fff', borderColor: '#555' }} />Мастер</span>
    </div>
  );
}

function OrderDetail({ s, now, order, candidates, candidate, setCandidate, route, onBack, onShowMaster }) {
  const m = order.masterId ? masterInfo(order.masterId) : null;
  const prog = order.status === 'enroute' && m ? travelProgress(s, m.id, now) : null;
  const tl = order.timeline;
  return (
    <div className="detail">
      <button className="link" onClick={onBack}>← Все заявки</button>
      <div className="detail-head">
        <h2>№{order.num}</h2>
        <StatusBadge status={order.status} />
      </div>
      <div className="detail-addr">{order.address}</div>
      <dl className="kv">
        <dt>Работа</dt><dd>{ORDER_TYPES[order.type].label}</dd>
        <dt>Проблема</dt><dd>{order.problem}</dd>
        <dt>Котёл</dt><dd>{order.boiler || '—'}</dd>
        <dt>Клиент</dt><dd>{order.client.name}<br /><span className="muted">{order.client.phone}</span></dd>
        <dt>Окно</dt><dd>{windowLabel(order.window)}</dd>
        <dt>Источник</dt><dd>{SOURCE_LABEL[order.source] || '—'}</dd>
      </dl>

      {order.status === 'new' && (
        <div className="assign">
          <h3>Кого отправить</h3>
          <p className="muted small">Ранжировано по расстоянию от текущего места мастера и его загрузке</p>
          <ul className="cands">
            {candidates.map((c, i) => (
              <li key={c.m.id}>
                <label className={`cand ${candidate === c.m.id ? 'on' : ''}`}>
                  <input type="radio" name="cand" checked={candidate === c.m.id} onChange={() => setCandidate(c.m.id)} />
                  <span className="cand-name">
                    {c.m.name}
                    {i === 0 && <em className="tag">лучший</em>}
                  </span>
                  <span className="cand-meta">
                    {candidate === c.m.id && route && route.source === '2gis'
                      ? `${km(route.distance)} · ${mins(route.duration)} по 2ГИС`
                      : `≈ ${km(c.distance)} · ${mins(c.duration)}`}
                    {' · '}в очереди {c.queue}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button className="btn primary wide" disabled={!candidate} onClick={() => assignOrder(order.id, candidate)}>
            Назначить: {candidate ? masterInfo(candidate).short : '—'}
          </button>
        </div>
      )}

      {m && (
        <div className="assigned-box">
          <div className="row between">
            <div>
              <div className="muted small">Мастер</div>
              <button className="link strong" onClick={() => onShowMaster(m.id)}>{m.name}</button>
            </div>
            {order.status === 'assigned' && <button className="btn small" onClick={() => unassignOrder(order.id)}>Снять</button>}
          </div>
          {order.status === 'assigned' && route && (
            <div className="muted small">До объекта: {km(route.distance)} · {mins(route.duration)}{route.source === 'estimate' ? ' (оценка)' : ''}</div>
          )}
          {prog && (
            <div className="progress">
              <div className="bar"><i style={{ width: `${Math.round(prog.t * 100)}%` }} /></div>
              <div className="small">{prog.t >= 1 ? 'Мастер у объекта, ждём отметку «На месте»' : `Прибудет через ~${mins(prog.etaSec)}`}</div>
            </div>
          )}
        </div>
      )}

      <ol className="timeline">
        <li className="done">Создана · {clock(tl.createdAt)}</li>
        <li className={tl.assignedAt ? 'done' : ''}>Назначена{tl.assignedAt ? ` · ${clock(tl.assignedAt)}` : ''}</li>
        <li className={tl.enrouteAt ? 'done' : ''}>Выехал{tl.enrouteAt ? ` · ${clock(tl.enrouteAt)}` : ''}</li>
        <li className={tl.onsiteAt ? 'done' : ''}>На объекте{tl.onsiteAt ? ` · ${clock(tl.onsiteAt)}` : ''}</li>
        <li className={tl.doneAt ? 'done' : ''}>Выполнена{tl.doneAt ? ` · ${clock(tl.doneAt)}` : ''}</li>
      </ol>

      {order.status === 'done' && order.report && (
        <div className="report">
          <h3>Отчёт мастера</h3>
          <div className="strong">{money(order.amount)}</div>
          {order.report.works?.length > 0 && <div className="small">{order.report.works.join(', ')}</div>}
          {order.report.note && <p className="small">{order.report.note}</p>}
          {order.report.photos?.length > 0 && (
            <div className="photos">{order.report.photos.map((p, i) => <img key={i} src={p} alt={`Фото ${i + 1}`} />)}</div>
          )}
          {order.needsRepeat && <div className="warn small">Отмечено: нужен повторный выезд</div>}
        </div>
      )}
    </div>
  );
}

function MastersTab({ s, now, selMaster, setSelMaster, dayRoute, plan, setPlan, onOrder }) {
  if (selMaster) {
    const m = masterInfo(selMaster);
    const st = s.masters[selMaster];
    const queue = masterQueue(s, selMaster);
    const left = queue.filter((o) => o.status !== 'done');
    const prog = travelProgress(s, selMaster, now);
    return (
      <div className="detail">
        <button className="link" onClick={() => setSelMaster(null)}>← Все мастера</button>
        <div className="detail-head">
          <h2>{m.name}</h2>
          <StatusBadge status={st.status} master />
        </div>
        {prog && st.status === 'enroute' && <div className="muted small">В пути, осталось ~{mins(prog.etaSec)}</div>}
        <div className="stats3">
          <div><b>{queue.filter((o) => o.status === 'done').length}</b><span>выполнено</span></div>
          <div><b>{left.length}</b><span>осталось</span></div>
          <div><b>{money(queue.reduce((a, o) => a + (o.amount || 0), 0)).replace(' сом', '')}</b><span>сом сегодня</span></div>
        </div>

        <h3>Маршрут на сегодня</h3>
        {dayRoute && left.length > 0 && (
          <div className="muted small">Осталось проехать: {km(dayRoute.distance)} · {mins(dayRoute.duration)}{dayRoute.source === 'estimate' ? ' (оценка)' : ''}</div>
        )}
        <ol className="queue">
          {queue.map((o) => (
            <li key={o.id} className={o.status === 'done' ? 'q-done' : ''}>
              <button className="qitem" onClick={() => onOrder(o.id)}>
                <span>
                  {o.status !== 'done' && <b className="qnum">{left.findIndex((x) => x.id === o.id) + 1}</b>}
                  {windowLabel(o.window)} · {o.address}
                </span>
                <StatusBadge status={o.status} />
              </button>
            </li>
          ))}
        </ol>
        {left.filter((o) => o.status === 'assigned').length >= 2 && !plan && (
          <button className="btn wide" onClick={() => setPlan(planOptimization(s, selMaster))}>Оптимизировать порядок объезда</button>
        )}
        {plan && (
          <div className="plan">
            {plan.changed ? (
              <>
                <div className="strong">Можно сэкономить {km((plan.beforeKm - plan.afterKm) * 1000)}</div>
                <div className="small muted">Было ≈ {km(plan.beforeKm * 1000)} → станет ≈ {km(plan.afterKm * 1000)}</div>
                <div className="row gap">
                  <button className="btn primary" onClick={() => { applyOrder(selMaster, plan.ids); setPlan(null); }}>Применить</button>
                  <button className="btn" onClick={() => setPlan(null)}>Отмена</button>
                </div>
              </>
            ) : (
              <div className="small">Порядок уже оптимальный 👍</div>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <ul className="mlist">
      {MASTERS.map((m) => {
        const st = s.masters[m.id];
        const q = masterQueue(s, m.id);
        const cur = q.find((o) => ['enroute', 'onsite'].includes(o.status));
        return (
          <li key={m.id}>
            <button className="mcard" onClick={() => setSelMaster(m.id)} disabled={st.status === 'off'}>
              <span className="avatar" style={{ '--c': MASTER_STATUS[st.status].color }}>{initials(m.name)}</span>
              <span className="mcard-body">
                <span className="strong">{m.name}</span>
                <span className="small muted">
                  {st.status === 'off' ? 'Выходной' : cur ? `${MASTER_STATUS[st.status].label}: ${cur.address}` : 'Свободен'}
                </span>
              </span>
              <span className="mcard-count">{q.filter((o) => o.status === 'done').length}/{q.length}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NewOrderForm({ form, setForm, onCreated }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const loc = LOCALITIES.find((l) => l.id === form.localityId);
  const valid = form.address && form.lat;
  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const id = createOrder({
      clientName: form.clientName,
      phone: form.phone,
      localityId: form.localityId,
      address: `${loc.city ? '' : loc.name + ', '}${form.address}`,
      lat: form.lat,
      lon: form.lon,
      type: form.type,
      problem: form.problem,
      boiler: form.boiler,
      window: form.window,
      source: form.source || 'phone',
    });
    onCreated(id);
  };
  return (
    <form className="form" onSubmit={submit}>
      <button type="button" className="link" onClick={() => setForm(null)}>← Отмена</button>
      <h2>Новая заявка</h2>
      <label>Клиент<input value={form.clientName || ''} onChange={set('clientName')} placeholder="Имя" /></label>
      <label>Телефон<input value={form.phone || ''} onChange={set('phone')} placeholder="+996 ..." inputMode="tel" /></label>
      <label>Населённый пункт
        <select value={form.localityId} onChange={(e) => {
          const l = LOCALITIES.find((x) => x.id === e.target.value);
          setForm((f) => ({ ...f, localityId: l.id, lat: l.lat, lon: l.lon }));
        }}>
          {LOCALITIES.map((l) => <option key={l.id} value={l.id}>{l.city ? `Бишкек, ${l.area}` : l.area}</option>)}
        </select>
      </label>
      <label>Адрес<input value={form.address || ''} onChange={set('address')} placeholder="Улица, дом" required /></label>
      <div className={`small ${form.lat ? 'muted' : 'warn'}`}>
        {form.lat ? `Точка на карте: ${form.lat.toFixed(4)}, ${form.lon.toFixed(4)} — можно уточнить кликом` : 'Укажите точку кликом на карте или выберите населённый пункт'}
      </div>
      <label>Вид работ
        <select value={form.type} onChange={set('type')}>
          {Object.entries(ORDER_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
      </label>
      <label>Котёл
        <select value={form.boiler || ''} onChange={set('boiler')}>
          <option value="">Не знаю</option>
          {BOILERS.map((b) => <option key={b}>{b}</option>)}
        </select>
      </label>
      <label>Что случилось<textarea rows={2} value={form.problem || ''} onChange={set('problem')} placeholder={ORDER_TYPES[form.type].problems[0]} /></label>
      <label>Удобное время
        <select value={form.window[0]} onChange={(e) => { const st = +e.target.value; setForm((f) => ({ ...f, window: [st, st + 120] })); }}>
          {[9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => <option key={h} value={h * 60}>{`${h}:00–${h + 2}:00`}</option>)}
        </select>
      </label>
      <button className="btn primary wide" disabled={!valid}>Создать заявку</button>
    </form>
  );
}
