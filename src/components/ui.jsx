import { useEffect, useState } from 'react';
import { STATUS, MASTER_STATUS } from '../config.js';
import { getRoutingSource, onRoutingSource } from '../routing.js';

export function StatusBadge({ status, master = false }) {
  const s = (master ? MASTER_STATUS : STATUS)[status];
  if (!s) return null;
  return (
    <span className="badge" style={{ '--c': s.color }}>
      <i />
      {s.label}
    </span>
  );
}

export function RoutingBadge() {
  const [src, setSrc] = useState(getRoutingSource());
  useEffect(() => onRoutingSource(setSrc), []);
  if (!src) return null;
  const ok = src.kind === '2gis';
  return (
    <span className={`routing-badge ${ok ? 'ok' : ''}`} title={ok ? 'Маршруты строит Routing API 2ГИС' : `Маршруты приблизительные: ${src.detail || ''}`}>
      {ok ? 'Маршруты: 2ГИС' : 'Маршруты: оценка'}
    </span>
  );
}

export function Toast({ text, onDone }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [text, onDone]);
  if (!text) return null;
  return <div className="toast" role="status">{text}</div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
