export const money = (n) => `${Math.round(n || 0).toLocaleString('ru-RU')} сом`;
export const moneyShort = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} млн сом` : money(n);
export const km = (m) => (m == null ? '—' : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} км`);
export const mins = (s) => (s == null ? '—' : `${Math.max(1, Math.round(s / 60))} мин`);
export const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const windowLabel = (w) => (w ? `${hhmm(w[0])}–${hhmm(w[1])}` : '—');
export const clock = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const initials = (name) =>
  name
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2);
export const durationHuman = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
};
export const SOURCE_LABEL = { whatsapp: 'WhatsApp', phone: 'Звонок', instagram: 'Instagram' };
