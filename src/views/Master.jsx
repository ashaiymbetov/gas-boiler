import { useEffect, useMemo, useState } from 'react';
import MapView, { orderPinHtml, masterPinHtml } from '../components/MapView.jsx';
import { StatusBadge, Toast } from '../components/ui.jsx';
import {
  useStore, useNow, masterQueue, masterPosition, travelProgress, master as masterInfo,
  startTravel, arrive, completeOrder, ensureTravelPaths,
} from '../store.js';
import { MASTERS, STATUS, MASTER_STATUS, ORDER_TYPES, WORK_ITEMS } from '../config.js';
import { getRoute, dgisDirectionsLink } from '../routing.js';
import { km, mins, windowLabel, money, initials } from '../format.js';

export default function Master({ masterId, embedded = false }) {
  if (!masterId) return <MasterLogin />;
  return <MasterApp key={masterId} masterId={masterId} embedded={embedded} />;
}

function MasterLogin() {
  const s = useStore();
  return (
    <div className="mobile">
      <div className="m-login">
        <h1>Вход для мастера</h1>
        <p className="muted">В реальной системе — по номеру телефона и SMS-коду. В демо выберите мастера:</p>
        <ul className="mlist">
          {MASTERS.map((m) => (
            <li key={m.id}>
              <a className="mcard" href={`#/master/${m.id}`}>
                <span className="avatar" style={{ '--c': MASTER_STATUS[s.masters[m.id].status].color }}>{initials(m.name)}</span>
                <span className="mcard-body">
                  <span className="strong">{m.name}</span>
                  <span className="small muted">{MASTER_STATUS[s.masters[m.id].status].label}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MasterApp({ masterId, embedded }) {
  const s = useStore();
  const now = useNow(500);
  const m = masterInfo(masterId);
  const st = s.masters[masterId];
  const queue = masterQueue(s, masterId);
  const current = queue.find((o) => ['enroute', 'onsite'].includes(o.status)) || queue.find((o) => o.status === 'assigned');
  const next = queue.filter((o) => o.status === 'assigned' && o.id !== current?.id);
  const done = queue.filter((o) => o.status === 'done');
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [toast, setToast] = useState('');
  const [route, setRoute] = useState(null);
  const pos = masterPosition(s, masterId, now);
  const prog = travelProgress(s, masterId, now);

  useEffect(() => {
    ensureTravelPaths();
  }, []);

  // Маршрут до текущей заявки (для назначенной — превью)
  const routeKey = current ? `${current.id}:${current.status}` : null;
  useEffect(() => {
    setRoute(null);
    if (!current || current.status !== 'assigned') return;
    let alive = true;
    getRoute([masterPosition(s, masterId), [current.lat, current.lon]]).then((r) => alive && setRoute(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useEffect(() => setCompleting(false), [current?.id]);

  const fit = useMemo(
    () => (current ? { key: routeKey, points: [masterPosition(s, masterId), [current.lat, current.lon]] } : pos ? { key: 'pos', points: [pos] } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeKey],
  );

  const markers = [];
  const polylines = [];
  if (current) {
    markers.push({ id: current.id, lat: current.lat, lon: current.lon, html: orderPinHtml(STATUS[current.status].color, `${current.num}`, { selected: true }), size: [44, 30], anchor: [22, 30] });
  }
  if (pos) markers.push({ id: 'me', lat: pos[0], lon: pos[1], html: masterPinHtml(MASTER_STATUS[st.status].color, initials(m.name), { moving: st.status === 'enroute' }), size: [36, 36], anchor: st.status === 'onsite' ? [2, 6] : [18, 18], z: 1000 });
  const line = st.status === 'enroute' ? st.travel?.path : route?.coords;
  const lineSrc = st.status === 'enroute' ? st.travel?.source : route?.source;
  if (line) polylines.push({ id: 'r', coords: line, color: st.status === 'enroute' ? MASTER_STATUS.enroute.color : STATUS.assigned.color, dash: lineSrc === 'estimate' ? '8 8' : undefined });

  const go = async () => {
    setBusy(true);
    try {
      await startTravel(current.id);
      setToast('Клиенту отправлено: «Мастер выехал»');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`mobile ${embedded ? 'mobile--embedded' : ''}`}>
      <header className="m-head">
        <div>
          <div className="strong">{m.short}</div>
          <div className="small muted">Сегодня: {done.length} из {queue.length} заявок</div>
        </div>
        <StatusBadge status={st.status} master />
      </header>

      <div className="m-map">
        <MapView markers={markers} polylines={polylines} fit={fit} />
      </div>

      <div className="m-body">
        {!current && (
          <div className="m-card m-empty">
            <div className="strong">Заявок нет</div>
            <div className="small muted">Новые заявки от диспетчера появятся здесь автоматически</div>
          </div>
        )}

        {current && !completing && (
          <div className="m-card">
            <div className="row between">
              <StatusBadge status={current.status} />
              <span className="small muted">№{current.num} · {windowLabel(current.window)}</span>
            </div>
            <div className="m-addr">{current.address}</div>
            <div className="small">{ORDER_TYPES[current.type].label} · {current.boiler || 'котёл не указан'}</div>
            <div className="m-problem">{current.problem}</div>
            <div className="small muted">{current.client.name} · {current.client.phone}</div>

            {current.status === 'assigned' && route && (
              <div className="small muted">Ехать: {km(route.distance)} · {mins(route.duration)}{route.source === 'estimate' ? ' (оценка)' : ''}</div>
            )}
            {current.status === 'enroute' && prog && (
              <div className="progress">
                <div className="bar"><i style={{ width: `${Math.round(prog.t * 100)}%` }} /></div>
                <div className="small">{prog.t >= 1 ? 'Вы на месте?' : `Осталось ~${mins(prog.etaSec)}`}</div>
              </div>
            )}

            <div className="m-actions">
              <a className="btn" href={dgisDirectionsLink([current.lat, current.lon], pos)} target="_blank" rel="noreferrer">Маршрут в 2ГИС</a>
              <button className="btn" onClick={() => setToast('В демо звонки отключены')}>Позвонить</button>
            </div>

            {current.status === 'assigned' && (
              <button className="btn primary big" disabled={busy || st.status === 'onsite' || st.status === 'enroute'} onClick={go}>
                {busy ? 'Строим маршрут…' : 'Выехал'}
              </button>
            )}
            {current.status === 'enroute' && <button className="btn primary big" onClick={() => arrive(current.id)}>На месте</button>}
            {current.status === 'onsite' && <button className="btn primary big" onClick={() => setCompleting(true)}>Завершить заявку</button>}
          </div>
        )}

        {current && completing && (
          <CompleteForm order={current} onCancel={() => setCompleting(false)} onDone={() => { setCompleting(false); setToast('Заявка закрыта. Клиенту отправлен акт'); }} />
        )}

        {next.length > 0 && (
          <>
            <h3 className="m-h3">Дальше</h3>
            <ul className="m-list">
              {next.map((o) => (
                <li key={o.id}>
                  <span className="strong small">{windowLabel(o.window)}</span>
                  <span>{o.address}</span>
                  <span className="small muted">{ORDER_TYPES[o.type].label}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {done.length > 0 && (
          <>
            <h3 className="m-h3">Выполнено сегодня</h3>
            <ul className="m-list m-list--done">
              {done.map((o) => (
                <li key={o.id}>
                  <span>{o.address}</span>
                  <span className="small muted">{money(o.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Toast text={toast} onDone={() => setToast('')} />
    </div>
  );
}

function shrinkImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 480 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function CompleteForm({ order, onCancel, onDone }) {
  const t = ORDER_TYPES[order.type];
  const [works, setWorks] = useState([]);
  const [amount, setAmount] = useState(Math.round((t.price[0] + t.price[1]) / 2 / 100) * 100);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [repeat, setRepeat] = useState(false);
  const toggle = (w) => setWorks((x) => (x.includes(w) ? x.filter((y) => y !== w) : [...x, w]));
  const addPhotos = async (e) => {
    const files = [...e.target.files].slice(0, 3);
    const res = (await Promise.all(files.map(shrinkImage))).filter(Boolean);
    setPhotos((p) => [...p, ...res].slice(0, 3));
  };
  return (
    <form className="m-card form" onSubmit={(e) => { e.preventDefault(); completeOrder(order.id, { amount: +amount, works, note, photos, needsRepeat: repeat }); onDone(); }}>
      <div className="strong">Отчёт по заявке №{order.num}</div>
      <div className="small muted">Что сделано</div>
      <div className="chips">
        {WORK_ITEMS.map((w) => (
          <button type="button" key={w} className={`chip ${works.includes(w) ? 'on' : ''}`} onClick={() => toggle(w)} aria-pressed={works.includes(w)}>{w}</button>
        ))}
      </div>
      <label>Сумма, сом<input type="number" min="0" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" /></label>
      <label>Комментарий<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: заменил датчик, рекомендовал чистку через год" /></label>
      <label className="file">Фото работы (до 3)
        <input type="file" accept="image/*" capture="environment" multiple onChange={addPhotos} />
      </label>
      {photos.length > 0 && <div className="photos">{photos.map((p, i) => <img key={i} src={p} alt={`Фото ${i + 1}`} />)}</div>}
      <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Нужен повторный выезд</label>
      <button className="btn primary big" disabled={works.length === 0}>Закрыть заявку</button>
      <button type="button" className="btn" onClick={onCancel}>Назад</button>
    </form>
  );
}
