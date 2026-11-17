import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_DEFAULT } from '../config.js';

// Растровые тайлы 2ГИС; если они не загружаются — переключаемся на OpenStreetMap.
const DGIS_TILES = 'https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1';
const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * markers:   [{ id, lat, lon, html, size:[w,h], anchor:[x,y], z, title, onClick }]
 * polylines: [{ id, coords:[[lat,lon]...], color, weight, dash, opacity }]
 * fit:       { key, points:[[lat,lon]...] } — при смене key карта подстраивается под точки
 */
export default function MapView({ markers = [], polylines = [], fit, onMapClick, className = '', cursor }) {
  const el = useRef(null);
  const map = useRef(null);
  const markerLayer = useRef(new Map());
  const lineLayer = useRef(new Map());
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(MAP_DEFAULT.center, MAP_DEFAULT.zoom);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    let loaded = 0;
    let errors = 0;
    let switched = false;
    const dgis = L.tileLayer(DGIS_TILES, { subdomains: '0123', maxZoom: 18, attribution: '© 2ГИС' }).addTo(m);
    dgis.on('tileload', () => loaded++);
    dgis.on('tileerror', () => {
      errors++;
      if (!switched && loaded === 0 && errors >= 4) {
        switched = true;
        m.removeLayer(dgis);
        L.tileLayer(OSM_TILES, { subdomains: 'abc', maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
      }
    });
    m.on('click', (e) => clickRef.current?.([e.latlng.lat, e.latlng.lng]));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      markerLayer.current.clear();
      lineLayer.current.clear();
    };
  }, []);

  // Маркеры: обновляем по id, чтобы анимация движения не мерцала
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set();
    for (const mk of markers) {
      seen.add(mk.id);
      const [w, h] = mk.size || [28, 28];
      let rec = markerLayer.current.get(mk.id);
      if (!rec) {
        const marker = L.marker([mk.lat, mk.lon], {
          icon: L.divIcon({ html: mk.html, className: 'mk', iconSize: [w, h], iconAnchor: mk.anchor || [w / 2, h / 2] }),
          zIndexOffset: mk.z || 0,
          title: mk.title || '',
          keyboard: !!mk.onClick,
        }).addTo(m);
        rec = { marker, html: mk.html };
        markerLayer.current.set(mk.id, rec);
      } else {
        rec.marker.setLatLng([mk.lat, mk.lon]);
        if (rec.html !== mk.html) {
          rec.marker.setIcon(L.divIcon({ html: mk.html, className: 'mk', iconSize: [w, h], iconAnchor: mk.anchor || [w / 2, h / 2] }));
          rec.html = mk.html;
        }
        rec.marker.setZIndexOffset(mk.z || 0);
      }
      rec.marker.off('click');
      if (mk.onClick) rec.marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        mk.onClick();
      });
    }
    for (const [id, rec] of markerLayer.current) {
      if (!seen.has(id)) {
        rec.marker.remove();
        markerLayer.current.delete(id);
      }
    }
  }, [markers]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set();
    for (const pl of polylines) {
      if (!pl.coords || pl.coords.length < 2) continue;
      seen.add(pl.id);
      const sig = `${pl.coords.length}:${pl.coords[0]}:${pl.coords[pl.coords.length - 1]}:${pl.color}:${pl.dash}`;
      const rec = lineLayer.current.get(pl.id);
      if (rec && rec.sig === sig) continue;
      if (rec) rec.layers.forEach((l) => l.remove());
      const layers = [];
      // светлая обводка под линией — маршрут читается на любой подложке
      layers.push(L.polyline(pl.coords, { color: '#fff', weight: (pl.weight || 5) + 4, opacity: 0.9, interactive: false }).addTo(m));
      layers.push(L.polyline(pl.coords, { color: pl.color || '#2a78d6', weight: pl.weight || 5, opacity: pl.opacity ?? 0.95, dashArray: pl.dash, interactive: false }).addTo(m));
      lineLayer.current.set(pl.id, { sig, layers });
    }
    for (const [id, rec] of lineLayer.current) {
      if (!seen.has(id)) {
        rec.layers.forEach((l) => l.remove());
        lineLayer.current.delete(id);
      }
    }
  }, [polylines]);

  const fitKey = fit?.key;
  useEffect(() => {
    const m = map.current;
    if (!m || !fit?.points?.length) return;
    if (fit.points.length === 1) m.flyTo(fit.points[0], Math.max(m.getZoom(), 14), { duration: 0.6 });
    else m.flyToBounds(L.latLngBounds(fit.points), { padding: [60, 60], maxZoom: 15, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={el} className={`map ${className}`} style={cursor ? { cursor } : undefined} />;
}

// ---------- HTML маркеров ----------

export function orderPinHtml(color, label, { selected, dim } = {}) {
  return `<div class="pin ${selected ? 'pin--sel' : ''} ${dim ? 'pin--dim' : ''}" style="--c:${color}"><span>${label}</span></div>`;
}

export function masterPinHtml(color, initials, { selected, moving } = {}) {
  return `<div class="mpin ${selected ? 'mpin--sel' : ''} ${moving ? 'mpin--moving' : ''}" style="--c:${color}"><span>${initials}</span></div>`;
}
