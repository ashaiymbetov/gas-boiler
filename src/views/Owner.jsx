import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { MASTERS, LOCALITIES, ORDER_TYPES } from '../config.js';
import { money, moneyShort, durationHuman } from '../format.js';
import { todayStr } from '../data/seed.js';

const PERIODS = [
  [7, '7 дней'],
  [30, '30 дней'],
];

function dayKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return todayStr(d);
}

function computeStats(orders, days) {
  const keys = new Set(Array.from({ length: days }, (_, i) => dayKey(-i)));
  const done = orders.filter((o) => o.status === 'done' && keys.has(o.date));
  const paid = done.filter((o) => !o.warranty);
  const revenue = paid.reduce((a, o) => a + (o.amount || 0), 0);
  const onsiteMin = done.filter((o) => o.timeline.onsiteAt && o.timeline.doneAt).map((o) => (o.timeline.doneAt - o.timeline.onsiteAt) / 60000);
  const repeats = paid.filter((o) => o.needsRepeat).length;
  const late = done.filter((o) => o.late).length;
  const rated = done.filter((o) => o.rating);
  return {
    done,
    count: done.length,
    revenue,
    avgCheck: paid.length ? revenue / paid.length : 0,
    avgOnsite: onsiteMin.length ? onsiteMin.reduce((a, b) => a + b, 0) / onsiteMin.length : 0,
    repeatRate: paid.length ? repeats / paid.length : 0,
    lateRate: done.length ? late / done.length : 0,
    rating: rated.length ? rated.reduce((a, o) => a + o.rating, 0) / rated.length : 0,
    warranty: done.filter((o) => o.warranty).length,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;

export default function Owner() {
  const s = useStore();
  const [days, setDays] = useState(30);

  const total = useMemo(() => computeStats(s.orders, days), [s.orders, days]);
  const prev = useMemo(() => {
    if (days !== 7) return null;
    const keys = new Set(Array.from({ length: 7 }, (_, i) => dayKey(-7 - i)));
    const done = s.orders.filter((o) => o.status === 'done' && keys.has(o.date));
    return { count: done.length, revenue: done.filter((o) => !o.warranty).reduce((a, o) => a + (o.amount || 0), 0) };
  }, [s.orders, days]);

  const byMaster = useMemo(
    () =>
      MASTERS.map((m) => ({ m, ...computeStats(s.orders.filter((o) => o.masterId === m.id), days) })).sort((a, b) => b.revenue - a.revenue),
    [s.orders, days],
  );

  const byDay = useMemo(
    () =>
      Array.from({ length: days }, (_, i) => {
        const k = dayKey(-(days - 1 - i));
        const list = total.done.filter((o) => o.date === k);
        const d = new Date(k + 'T00:00');
        return {
          label: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
          short: String(d.getDate()),
          value: list.length,
          sub: money(list.filter((o) => !o.warranty).reduce((a, o) => a + (o.amount || 0), 0)),
          weekend: d.getDay() === 0,
        };
      }),
    [total, days],
  );

  const byLocality = useMemo(() => {
    const map = new Map();
    for (const o of total.done) {
      const l = LOCALITIES.find((x) => x.id === o.locality);
      const name = l ? l.name : '—';
      map.set(name, (map.get(name) || 0) + 1);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [total]);

  const byType = useMemo(() => {
    const map = new Map();
    for (const o of total.done) {
      if (o.warranty) continue;
      map.set(o.type, (map.get(o.type) || 0) + (o.amount || 0));
    }
    return [...map.entries()].map(([k, value]) => ({ label: ORDER_TYPES[k].label, value, display: money(value) })).sort((a, b) => b.value - a.value);
  }, [total]);

  // Автоматические подсказки владельцу
  const insights = useMemo(() => {
    const out = [];
    const active = byMaster.filter((x) => x.count >= 5);
    const worstRepeat = [...active].sort((a, b) => b.repeatRate - a.repeatRate)[0];
    if (worstRepeat && worstRepeat.repeatRate > total.repeatRate * 1.6 && worstRepeat.repeatRate >= 0.08) {
      out.push({ level: 'serious', text: `${worstRepeat.m.name}: ${pct(worstRepeat.repeatRate)} заявок заканчиваются повторным выездом, в среднем по команде ${pct(total.repeatRate)}. Стоит разобрать эти случаи.` });
    }
    const worstLate = [...active].sort((a, b) => b.lateRate - a.lateRate)[0];
    if (worstLate && worstLate.lateRate > total.lateRate * 1.5 && worstLate.lateRate >= 0.12) {
      out.push({ level: 'warning', text: `${worstLate.m.name}: опоздания к клиентам в ${pct(worstLate.lateRate)} случаев. Возможно, заявки слишком далёкие — проверьте маршруты.` });
    }
    if (total.warranty > 0) {
      out.push({ level: 'info', text: `${total.warranty} бесплатных гарантийных выездов за период. Это время мастеров и бензин, за которые никто не заплатил.` });
    }
    const best = [...active].sort((a, b) => b.rating - a.rating)[0];
    if (best) out.push({ level: 'good', text: `Лучшая оценка клиентов: ${best.m.name}, ${best.rating.toFixed(1).replace('.', ',')} из 5.` });
    return out;
  }, [byMaster, total]);

  const delta = (cur, old) => {
    if (!old) return null;
    const d = (cur - old) / old;
    return <span className={`delta ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? '▲' : '▼'} {pct(Math.abs(d))} к прошлой неделе</span>;
  };

  return (
    <div className="owner">
      <div className="owner-head">
        <div>
          <h1>Сводка для владельца</h1>
          <p className="muted">Все показатели считаются автоматически по отметкам мастеров в приложении</p>
        </div>
        <div className="seg" role="group" aria-label="Период">
          {PERIODS.map(([d, l]) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)} aria-pressed={days === d}>{l}</button>
          ))}
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Выполнено заявок" value={total.count} extra={prev && delta(total.count, prev.count)} />
        <Kpi label="Выручка" value={moneyShort(total.revenue)} extra={prev && delta(total.revenue, prev.revenue)} />
        <Kpi label="Средний чек" value={money(total.avgCheck)} />
        <Kpi label="Время на объекте" value={durationHuman(total.avgOnsite)} hint="в среднем" />
        <Kpi label="Повторные выезды" value={pct(total.repeatRate)} hint="заявки, где пришлось ехать снова" />
        <Kpi label="Опоздания" value={pct(total.lateRate)} hint="приезд позже окна клиента" />
      </div>

      {insights.length > 0 && (
        <section className="card insights">
          <h2>На что обратить внимание</h2>
          <ul>
            {insights.map((x, i) => (
              <li key={i} className={`ins ins-${x.level}`}>
                <span className="ins-icon" aria-hidden="true">{{ serious: '!', warning: '!', info: 'i', good: '✓' }[x.level]}</span>
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Выполненные заявки по дням</h2>
        <ColumnChart data={byDay} />
      </section>

      <section className="card">
        <h2>Мастера</h2>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Мастер</th>
                <th className="num">Заявок</th>
                <th className="num">Выручка</th>
                <th className="num">Ср. чек</th>
                <th className="num">На объекте</th>
                <th className="num">Опоздания</th>
                <th className="num">Повторные</th>
                <th className="num">Оценка</th>
              </tr>
            </thead>
            <tbody>
              {byMaster.map((x) => (
                <tr key={x.m.id}>
                  <td className="strong">{x.m.name}</td>
                  <td className="num">{x.count}</td>
                  <td className="num">{money(x.revenue)}</td>
                  <td className="num">{money(x.avgCheck)}</td>
                  <td className="num">{durationHuman(x.avgOnsite)}</td>
                  <td className={`num ${x.lateRate >= 0.15 ? 'flag' : ''}`}>{x.lateRate >= 0.15 && <Flag />}{pct(x.lateRate)}</td>
                  <td className={`num ${x.repeatRate >= 0.09 ? 'flag' : ''}`}>{x.repeatRate >= 0.09 && <Flag />}{pct(x.repeatRate)}</td>
                  <td className="num">{x.rating ? x.rating.toFixed(1).replace('.', ',') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Выручка по видам работ</h2>
          <HBars data={byType} />
        </section>
        <section className="card">
          <h2>Заявки по населённым пунктам</h2>
          <HBars data={byLocality.map((x) => ({ ...x, display: `${x.value}` }))} />
        </section>
      </div>
    </div>
  );
}

function Flag() {
  return <span className="flag-icon" aria-label="выше нормы" title="Выше нормы">⚠︎</span>;
}

function Kpi({ label, value, hint, extra }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {extra || (hint && <div className="kpi-hint">{hint}</div>)}
    </div>
  );
}

// Столбчатая диаграмма (одна серия) с подсказкой при наведении
function ColumnChart({ data }) {
  const [hover, setHover] = useState(null);
  const W = 900;
  const H = 220;
  const pad = { l: 32, r: 8, t: 12, b: 26 };
  const max = Math.max(4, ...data.map((d) => d.value));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / data.length;
  const barW = Math.max(4, Math.min(28, bw - 4));
  const y = (v) => pad.t + ih - (v / top) * ih;
  const labelEvery = data.length > 14 ? 5 : 1;

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Выполненные заявки по дням">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(i * step)} y2={y(i * step)} className="grid" />
            <text x={pad.l - 6} y={y(i * step) + 4} className="axis" textAnchor="end">{i * step}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + (bw - barW) / 2;
          const h = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={i}>
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + barW - r} Q${x + barW},${y(d.value)} ${x + barW},${y(d.value) + r} V${y(0)} Z`}
                  className={`bar ${hover === i ? 'on' : ''}`}
                />
              )}
              {(i % labelEvery === 0 || i === data.length - 1) && (
                <text x={x + barW / 2} y={H - 8} className="axis" textAnchor="middle">{labelEvery > 1 ? d.short : d.label}</text>
              )}
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%` }}>
          <div className="strong">{data[hover].label}</div>
          <div>{data[hover].value} заявок</div>
          <div className="muted">{data[hover].sub}</div>
        </div>
      )}
    </div>
  );
}

function HBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="hbars">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${d.display ?? d.value}`}>
          <span className="hb-label">{d.label}</span>
          <span className="hb-track"><i style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="hb-val">{d.display ?? d.value}</span>
        </li>
      ))}
    </ul>
  );
}
