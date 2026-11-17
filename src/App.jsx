import { useEffect, useState } from 'react';
import Dispatcher from './views/Dispatcher.jsx';
import Master from './views/Master.jsx';
import Owner from './views/Owner.jsx';
import { RoutingBadge } from './components/ui.jsx';
import { PRODUCT } from './config.js';
import { resetDemo, ensureTravelPaths } from './store.js';
import { getUserKey, setUserKey } from './routing.js';

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

const NAV = [
  ['/dispatcher', 'Диспетчер'],
  ['/master', 'Мастер'],
  ['/owner', 'Владелец'],
  ['/demo', 'Диспетчер + телефон'],
];

export default function App() {
  const path = useHash();
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    ensureTravelPaths();
  }, []);

  const parts = path.split('/').filter(Boolean);
  const section = parts[0] || '';

  // Мастер с телефона — без верхней панели, как настоящее приложение
  if (section === 'master') return <Master masterId={parts[1]} />;

  let view;
  if (section === 'dispatcher') view = <Dispatcher key="dispatcher" />;
  else if (section === 'demo') view = <Dispatcher key="demo" withPhone />;
  else if (section === 'owner') view = <Owner />;
  else view = <Home />;

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="logo" aria-hidden="true" />
          {PRODUCT.name}
        </a>
        <nav>
          {NAV.map(([p, l]) => (
            <a key={p} href={`#${p}`} className={`/${section}` === p ? 'on' : ''}>{l}</a>
          ))}
        </nav>
        <div className="topbar-right">
          <RoutingBadge />
          <button className="btn small" onClick={() => setSettings(true)}>Настройки</button>
        </div>
      </header>
      <main className="main">{view}</main>
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}

function Home() {
  return (
    <div className="home">
      <section className="hero">
        <h1>{PRODUCT.tagline}</h1>
        <p className="lead">
          Вместо заявок в WhatsApp: диспетчер видит всех мастеров на карте и назначает ближайшего.
          Мастер получает заявку в телефон с маршрутом 2ГИС. Владелец видит, кто и как работает.
        </p>
      </section>
      <div className="roles">
        <a className="role" href="#/dispatcher">
          <span className="role-k">01</span>
          <h2>Диспетчер</h2>
          <p>Заявки и мастера на карте Бишкека и Чуйской области. Подбор ближайшего мастера, маршруты, оптимизация объезда.</p>
          <span className="role-go">Открыть →</span>
        </a>
        <a className="role" href="#/master">
          <span className="role-k">02</span>
          <h2>Мастер</h2>
          <p>Приложение в телефоне: заявки на день, навигация в 2ГИС, кнопки «Выехал / На месте / Готово», фото и отчёт.</p>
          <span className="role-go">Открыть →</span>
        </a>
        <a className="role" href="#/owner">
          <span className="role-k">03</span>
          <h2>Владелец</h2>
          <p>Выручка, заявки, время на объекте, опоздания и повторные выезды по каждому мастеру.</p>
          <span className="role-go">Открыть →</span>
        </a>
      </div>
      <a className="demo-cta" href="#/demo">
        <strong>Режим для показа:</strong> диспетчер и телефон мастера на одном экране. Назначьте заявку и посмотрите, как она сразу появляется у мастера.
      </a>
      <p className="muted small center">Все данные вымышленные. Изменения сохраняются только в вашем браузере.</p>
    </div>
  );
}

function Settings({ onClose }) {
  const [key, setKey] = useState(getUserKey());
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="st-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="st-title">Настройки демо</h2>
        <label>
          Ключ API 2ГИС
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="вставьте демо-ключ с platform.2gis.ru" autoComplete="off" spellCheck={false} />
        </label>
        <p className="small muted">
          Нужен для настоящих маршрутов по дорогам с учётом пробок. Ключ хранится только в этом браузере.
          На сервере (Vercel) его лучше задать переменной окружения <code>DGIS_KEY</code>, тогда вводить его здесь не нужно.
        </p>
        <div className="row gap">
          <button className="btn primary" onClick={() => { setUserKey(key); onClose(); window.location.reload(); }}>Сохранить</button>
          <button className="btn" onClick={onClose}>Закрыть</button>
        </div>
        <hr />
        <button className="btn danger" onClick={() => { resetDemo(); onClose(); }}>Сбросить демо-данные</button>
        <p className="small muted">Вернёт заявки и мастеров в исходное состояние.</p>
      </div>
    </div>
  );
}
