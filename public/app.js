// Dasturxon POS — 1-etap frontend (build'siz, vanilla JS)
'use strict';

// ---------- Yordamchilar ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
const som = (n) => money(n) + " so'm";
const ago = (iso) => { const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}s ${m % 60}d` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '';
const dt = (iso) => { if (!iso) return ''; const d = new Date(iso), z = (n) => String(n).padStart(2, '0'); return `${z(d.getDate())}.${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

const ROLE_NAME = { admin: 'Admin', menejer: 'Menejer', kassir: 'Kassir', ofitsiant: 'Ofitsiant', oshpaz: 'Oshpaz', omborchi: 'Omborchi' };
const CASHR = ['admin', 'menejer', 'kassir'];
const HOOKS = {}; // staff.js va boshqa modullar ulanadigan joylar
const STATUS = { new: ['Yangi', 'info'], sent: ['Yuborildi', ''], cooking: ['Tayyorlanmoqda', 'warn'], ready: ['Tayyor', 'ok'], served: ['Berildi', ''], cancelled: ['Bekor', 'danger'] };
const METHODS = [['naqd', 'Naqd'], ['karta', 'Karta'], ['click', 'Click'], ['payme', 'Payme']];
const METHOD_NAME = { naqd: 'Naqd', karta: 'Karta', click: 'Click', payme: 'Payme', onlayn: 'Onlayn', kuryer: 'Kuryer naqdi', bonus: 'Bonus', zaklad: 'Zaklad' };
const REPORT_METHODS = [...METHODS, ['onlayn', 'Onlayn (ilova)'], ['kuryer', 'Kuryer naqdi (platformadan keladi)']]; // hisobotlarda; kassada qo'lda tanlanmaydi
const oname = (o) => o.table_name || (o.delivery_id ? `🛵 D-${o.delivery_id}` : ''); // stol nomi yoki yetkazib berish

const S = { token: store.get('token'), user: null, boot: null, orders: [], view: 'floor', hall: null, orderId: null, cat: null, search: '', pane: 'menu', ws: '', adminTab: 'products', kitchen: [] };
const can = (...roles) => S.user && roles.includes(S.user.role);

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), err ? 5000 : 2500);
}

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') { logout(true); throw new Error('Sessiya tugadi'); }
  if (!r.ok) throw new Error(j.error || 'Xatolik');
  return j;
}
const run = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };

// ---------- Modal ----------
function modal(html, { wide } = {}) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
    root.append(ov);
    const close = (v) => { ov.remove(); resolve(v); };
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return close(null);
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'close') close(null);
      if (b.dataset.m === 'ok') close({ ...collect(ov), _act: b.dataset.act || '' });
      if (b.dataset.m === 'val') close(b.dataset.v);
      if (b.dataset.m === 'toggle') b.classList.toggle('on');
    });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') close(collect(ov)); if (e.key === 'Escape') close(null); });
    ov._close = close;
    setTimeout(() => ov.querySelector('input,select,textarea')?.focus(), 30);
  });
}
function collect(ov) {
  const out = {};
  ov.querySelectorAll('[name]').forEach((el) => { out[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
  out._on = [...ov.querySelectorAll('[data-m="toggle"].on')].map((b) => b.dataset.v);
  return out;
}
const ask = async (title, label, { type = 'text', value = '', required = true } = {}) => {
  const r = await modal(`<h2>${esc(title)}</h2><label>${esc(label)}</label><input name="v" type="${type}" value="${esc(value)}" ${type === 'number' ? 'inputmode="numeric"' : ''}>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">OK</button></div>`);
  if (!r) return null;
  if (required && !String(r.v).trim()) { toast(`${label} kiritilmadi`, true); return null; }
  return r.v;
};
const confirmBox = async (title, text, okText = 'Ha', danger) => !!(await modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
  <div class="foot"><button class="btn" data-m="close">Yo'q</button><button class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${esc(okText)}</button></div>`));

// ---------- Kirish ----------
async function renderLogin() {
  let pin = '';
  const app = $('#app');
  if (!store.get('bizcode')) { // qurilma hali biznesga ulanmagan: bitta biznesli serverda o'zi ulanadi
    try { const b = await api('GET', '/api/business-info'); store.set('bizcode', b.code); store.set('bizname', b.name); } catch { return renderCodeStep(); }
  }
  const draw = () => {
    app.innerHTML = `<div class="login"><div class="login-box">
      <div class="brand" style="justify-content:center"><span class="dot"></span>${esc(store.get('bizname') || 'Dasturxon POS')}</div>
      <h1 style="margin-top:18px">PIN kodni kiriting</h1>
      <div class="pin-dots">${[0, 1, 2, 3].map((i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="c">⌫</button><button data-k="0">0</button><button data-k="ok" style="background:var(--accent);color:var(--accent-ink)">→</button></div>
      <div class="row" style="justify-content:center;margin-top:18px;gap:16px"><a class="muted small" href="#" data-k="reset">Boshqa biznes</a><a class="muted small" href="#owner">Ega kabineti</a></div>
    </div></div>`;
  };
  const submit = async () => {
    if (pin.length < 4) return;
    try {
      const r = await api('POST', '/api/login', { pin, code: store.get('bizcode') });
      store.set('bizcode', r.business.code); store.set('bizname', r.business.name);
      S.token = r.token; store.set('token', r.token); await start();
    } catch (e) {
      toast(e.message, true); pin = '';
      if (/kod/i.test(e.message)) { store.set('bizcode', null); return renderCodeStep(); }
      draw();
    }
  };
  const key = (k) => {
    if (k === 'reset') { store.set('bizcode', null); store.set('bizname', null); return renderCodeStep(); }
    if (k === 'c') pin = pin.slice(0, -1);
    else if (k === 'ok') return submit();
    else if (pin.length < 6) pin += k;
    draw();
    if (pin.length === 4 && !submit._lock) { submit._lock = true; setTimeout(() => { submit._lock = false; submit(); }, 120); }
  };
  app.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { e.preventDefault(); key(b.dataset.k); } };
  document.onkeydown = (e) => { if (S.user || location.hash) return; if (/^\d$/.test(e.key)) key(e.key); if (e.key === 'Backspace') key('c'); if (e.key === 'Enter') key('ok'); };
  draw();
}

// Qurilmani biznesga ulash: 6 xonali biznes kodi
function renderCodeStep() {
  let code = '';
  const app = $('#app');
  const draw = () => {
    app.innerHTML = `<div class="login"><div class="login-box">
      <div class="brand" style="justify-content:center"><span class="dot"></span>Dasturxon POS</div>
      <h1 style="margin-top:18px">Biznes kodi</h1><p class="muted small">Restoraningizning 6 xonali kodi (Boshqaruv → Sozlamalar yoki ega kabinetida)</p>
      <div class="pin-dots">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < code.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="c">⌫</button><button data-k="0">0</button><button data-k="ok" style="background:var(--accent);color:var(--accent-ink)">→</button></div>
      <div class="row" style="justify-content:center;margin-top:18px;gap:16px"><a class="muted small" href="#register">Yangi biznes ochish</a><a class="muted small" href="#owner">Ega kabineti</a></div>
    </div></div>`;
  };
  const submit = async () => {
    try { const b = await api('GET', '/api/business-info?code=' + code); store.set('bizcode', b.code); store.set('bizname', b.name); renderLogin(); }
    catch (e) { toast(e.message, true); code = ''; draw(); }
  };
  app.onclick = (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'c') code = code.slice(0, -1); else if (k === 'ok') return code.length === 6 && submit(); else if (code.length < 6) code += k;
    draw(); if (code.length === 6) submit();
  };
  document.onkeydown = (e) => { if (S.user || location.hash) return; const b = /^\d$/.test(e.key) ? e.key : e.key === 'Backspace' ? 'c' : null; if (b) app.querySelector(`[data-k="${b}"]`)?.click(); };
  draw();
}

async function logout(silent) {
  S.es?.close(); S.es = null; clearTimeout(refreshTimer);
  if (!silent && S.token) await api('POST', '/api/logout').catch(() => {});
  S.token = null; S.user = null; store.set('token', null);
  renderLogin();
}

// ---------- Ishga tushish ----------
async function loadBoot() { S.boot = await api('GET', '/api/bootstrap'); S.user = S.boot.user; }
async function loadOrders() { S.orders = await api('GET', '/api/orders?status=open'); }

async function start() {
  try { await loadBoot(); await loadOrders(); } catch { return renderLogin(); }
  document.onkeydown = null;
  S.view = { oshpaz: 'kitchen', omborchi: 'stock' }[S.user.role] || 'floor';
  await HOOKS.onStart?.();
  S.hall = S.boot.halls[0]?.id;
  if (S.view === 'kitchen') await loadKitchen();
  connectStream();
  render();
}

let refreshTimer;
async function connectStream() {
  S.es?.close();
  let ticket;
  try { ticket = (await api('POST', '/api/stream-ticket')).ticket; } catch { return setTimeout(() => S.user && connectStream(), 5000); }
  const es = new EventSource('/api/stream?ticket=' + encodeURIComponent(ticket));
  S.es = es;
  const pending = new Set();
  es.addEventListener('change', (e) => {
    pending.add(JSON.parse(e.data).type);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const types = [...pending]; pending.clear();
      if (types.includes('menu') || types.includes('shift')) await loadBoot().catch(() => {});
      if (types.includes('orders') || types.includes('shift')) await loadOrders().catch(() => {});
      await HOOKS.onChange?.(types);
      if (S.view === 'kitchen' && (types.includes('kitchen') || types.includes('orders') || types.includes('menu'))) await loadKitchen();
      softRender(types);
    }, 150);
  });
  es.onerror = () => { if (es.readyState === 2) setTimeout(() => S.user && connectStream(), 3000); };
}

// ---------- Asosiy qobiq ----------
function navItems() {
  const items = [];
  if (can('admin', 'menejer', 'kassir', 'ofitsiant')) items.push(['floor', 'Zal']);
  if (can('admin', 'menejer', 'oshpaz', 'kassir')) items.push(['kitchen', 'Oshxona']);
  if (can(...CASHR)) items.push(['cash', 'Kassa']);
  if (VIEWS.reservations && can('admin', 'menejer', 'kassir', 'ofitsiant')) items.push(['reservations', 'Bronlar']);
  if (VIEWS.customers && can(...CASHR)) items.push(['customers', 'Mijozlar']);
  if (can('admin', 'menejer', 'omborchi')) items.push(['stock', 'Ombor']);
  if (VIEWS.counter && can(...CASHR)) items.push(['counter', '🛒 Tez sotuv']); // 9-etap: stolsiz kassa (do'kon, dorixona, olib ketish)
  if (VIEWS.delivery && can(...CASHR) && S.boot.business.delivery && S.boot.business.delivery.status !== 'disabled') items.push(['delivery', `🛵 Yetkazish${S.dlvNew ? ` <span class="nbadge">${S.dlvNew}</span>` : ''}`]);
  if (VIEWS.staff && can('admin', 'menejer')) items.push(['staff', 'Xodimlar']);
  if (can('admin', 'menejer')) items.push(['reports', 'Hisobotlar']);
  if (can('admin')) items.push(['admin', 'Boshqaruv']);
  return items;
}

function render() {
  const sh = S.boot.shift;
  $('#app').innerHTML = `<div class="shell">
    <header class="top">
      <div class="brand"><span class="dot"></span>${esc(S.boot.business.name)}</div>
      <nav class="tabs">${navItems().map(([v, n]) => `<button data-a="nav" data-v="${v}" class="${S.view === v || (v === 'floor' && S.view === 'order') ? 'on' : ''}">${n}</button>`).join('')}</nav>
      <span class="chip ${sh ? 'ok' : 'warn'}">${sh ? 'Smena · ' + hhmm(sh.opened_at) : 'Smena yopiq'}</span>
      <span class="clock" id="clock"></span>
      ${HOOKS.header ? HOOKS.header() : ''}
      <span class="muted small who">${esc(S.user.name)} · ${ROLE_NAME[S.user.role]}</span>
      <button class="btn sm" data-a="logout">Chiqish</button>
    </header>
    ${subBanner()}
    <main id="main"></main></div>`;
  $('#app').onclick = onAction;
  $('#app').oninput = onInput;
  renderView();
}

const VIEWS = { floor: viewFloor, order: viewOrder, kitchen: viewKitchen, cash: viewCash, admin: viewAdmin }; // office.js stock/reports qo'shadi
function subBanner() {
  const bz = S.boot.business;
  if (bz.mirror) return `<div class="banner info">Bulutdagi nusxa — faqat ko'rish uchun. Oxirgi sinxron: ${bz.last_sync_at ? dt(bz.last_sync_at) : '—'}. Savdo restorandagi kompyuterda olib boriladi.</div>`;
  const s = bz.subscription; if (!s) return '';
  const msg = s.status === 'trial' && s.days_left <= 7 ? ['info', `Sinov muddati: ${s.days_left} kun qoldi. Davom ettirish uchun obunani to'lang.`]
    : s.status === 'grace' ? ['warn', `Obuna muddati tugadi. ${s.grace_left} kun ichida to'lanmasa, tizim faqat ko'rish rejimiga o'tadi.`]
    : s.status === 'expired' ? ['danger', "Obuna muddati tugagan — tizim faqat ko'rish rejimida. Ega kabineti orqali to'lovni amalga oshiring."] : null;
  return msg ? `<div class="banner ${msg[0]}">${esc(msg[1])}</div>` : '';
}
function renderView() {
  const main = $('#main');
  main.className = S.view === 'order' ? 'flush' : '';
  return VIEWS[S.view](main);
}

// SSE kelganda: kiritilayotgan matnni buzmaslik uchun faqat kerakli qismni yangilaymiz
function softRender(types) {
  if (!S.user || !$('#main')) return;
  const own = { customers: 'customers', staff: 'staff', reservations: 'reservations' }[S.view];
  if (own) { if (types.includes(own) && !document.querySelector('.overlay')) renderView(); return; }
  if (S.view === 'counter') { if (types.includes('menu')) renderView(); return; } // savat holati saqlanadi, faqat menyu o'zgarsa
  if (S.view === 'floor' && types.includes('reservations')) return renderView();
  if (S.view === 'stock' || S.view === 'reports') { if (types.includes('stock') && S.view === 'stock' && !document.querySelector('.overlay')) renderView(); return; }
  if (types.includes('shift') || types.includes('menu')) return render();
  if (S.view === 'order') {
    const o = S.orders.find((x) => x.id === S.orderId);
    if (!o) { toast('Buyurtma yopildi'); S.view = 'floor'; return render(); }
    renderTicket(); if (types.includes('menu')) renderProducts();
  } else if (S.view !== 'admin') renderView();
}

setInterval(() => {
  const c = $('#clock'); if (c) c.textContent = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = ago(el.dataset.since); });
  document.querySelectorAll('.kcard[data-sent]').forEach((el) => {
    const m = (Date.now() - new Date(el.dataset.sent)) / 60000;
    el.classList.toggle('late', m > 10 && m <= 20); el.classList.toggle('very-late', m > 20);
  });
}, 1000);

// ---------- Hodisalar ----------
const A = {}; // harakatlar
function onAction(e) {
  const el = e.target.closest('[data-a]');
  if (!el || !A[el.dataset.a]) return;
  e.stopPropagation();
  A[el.dataset.a](el, e);
}
function onInput(e) {
  if (e.target.id === 'search') { S.search = e.target.value; renderProducts(); }
}
A.nav = (el) => { S.view = el.dataset.v; if (S.view === 'kitchen') loadKitchen().then(render); else render(); };
A.logout = () => logout();

// ---------- ZAL ----------
function tableOrders(tid) { return S.orders.filter((o) => o.table_id === tid); }

function viewFloor(main) {
  const halls = S.boot.halls;
  if (!halls.find((h) => h.id === S.hall)) S.hall = halls[0]?.id;
  const tables = S.boot.tables.filter((t) => t.hall_id === S.hall);
  const mine = S.user.role === 'ofitsiant';
  main.innerHTML = `
    ${!S.boot.shift ? `<div class="panel row"><span class="chip warn">Smena yopiq</span><span class="muted">Buyurtma qabul qilish uchun kassir smenani ochishi kerak.</span>
      ${can(...CASHR) ? `<div class="grow"></div><button class="btn primary" data-a="nav" data-v="cash">Smenani ochish</button>` : ''}</div>` : ''}
    <div class="halls">${halls.map((h) => `<button class="btn ${h.id === S.hall ? 'primary' : ''}" data-a="hall" data-id="${h.id}">${esc(h.name)}</button>`).join('')}
      <div class="grow"></div><span class="muted small row">Ochiq buyurtmalar: <b>${S.orders.length}</b></span></div>
    <div class="tables">${tables.map((t) => {
      const os = tableOrders(t.id);
      const sum = os.reduce((s, o) => s + o.total, 0);
      const ready = os.some((o) => o.items.some((i) => i.status === 'ready'));
      const fresh = os.some((o) => o.items.some((i) => i.status === 'new'));
      const pre = os.some((o) => o.precheck_at);
      const foreign = mine && os.length && os.every((o) => o.waiter_id !== S.user.id);
      const first = os[0];
      return `<button class="table ${os.length ? 'busy' : ''} ${pre ? 'pre' : ''} ${foreign ? 'foreign' : ''}" data-a="table" data-id="${t.id}">
        <div class="row"><span class="name">${esc(t.name)}</span><div class="grow"></div><span class="muted small">${t.seats} o'rin</span></div>
        ${os.length ? `<div class="muted small">${esc(first.waiter_name || '')} · <span data-since="${first.created_at}">${ago(first.created_at)}</span>${os.length > 1 ? ` · ${os.length} chek` : ''}</div>
          <div class="badges">${HOOKS.tableBadge ? HOOKS.tableBadge(t) : ''}${ready ? '<span class="chip ok pulse">Tayyor taom</span>' : ''}${fresh ? '<span class="chip info">Yuborilmagan</span>' : ''}${pre ? '<span class="chip warn">Pre-chek</span>' : ''}</div>
          <div class="sum num">${som(sum)}</div>` : '<div class="muted small" style="margin-top:auto">Bo\'sh</div>'}
      </button>`.replace('<div class="muted small" style="margin-top:auto">Bo\'sh</div>', `${HOOKS.tableBadge ? `<div class="badges">${HOOKS.tableBadge(t)}</div>` : ''}<div class="muted small" style="margin-top:auto">Bo'sh</div>`);
    }).join('') || '<p class="muted">Bu zalda stol yo\'q. Boshqaruv bo\'limidan qo\'shing.</p>'}</div>`;
}
A.hall = (el) => { S.hall = Number(el.dataset.id); renderView(); };
A.table = async (el) => {
  const tid = Number(el.dataset.id);
  const os = tableOrders(tid);
  if (!os.length) return newOrder(tid);
  if (os.length === 1) return openOrder(os[0].id);
  const v = await modal(`<h2>${esc(S.boot.tables.find((t) => t.id === tid).name)}</h2><div class="pick">
    ${os.map((o) => `<button data-m="val" data-v="${o.id}"><b>#${o.number}</b><div class="muted small">${esc(o.waiter_name)} · ${som(o.total)}</div></button>`).join('')}
    <button data-m="val" data-v="new"><b>+ Yangi chek</b></button></div>
    <div class="foot"><button class="btn" data-m="close">Yopish</button></div>`);
  if (v === 'new') newOrder(tid); else if (v) openOrder(Number(v));
};
async function newOrder(tid) {
  if (!S.boot.shift) return toast('Smena ochilmagan', true);
  const g = await modal(`<h2>Mehmonlar soni</h2><div class="pick">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<button data-m="val" data-v="${n}" style="text-align:center;font-size:20px;font-weight:700">${n}</button>`).join('')}</div>
    <div class="foot"><button class="btn" data-m="close">Bekor</button></div>`);
  if (!g) return;
  await run(async () => { const o = await api('POST', '/api/orders', { table_id: tid, guests: Number(g) }); await loadOrders(); openOrder(o.id); });
}
function openOrder(id) {
  S.orderId = id; S.view = 'order'; S.pane = 'menu'; S.search = '';
  if (!S.boot.categories.find((c) => c.id === S.cat)) S.cat = S.boot.categories[0]?.id;
  render();
}

// ---------- BUYURTMA ----------
const curOrder = () => S.orders.find((o) => o.id === S.orderId);
function upsertOrder(o) { const i = S.orders.findIndex((x) => x.id === o.id); if (o.status !== 'open') { if (i >= 0) S.orders.splice(i, 1); } else if (i >= 0) S.orders[i] = o; else S.orders.push(o); }

function viewOrder(main) {
  main.innerHTML = `<div class="order" data-pane="${S.pane}">
    <div class="cats" id="cats"></div>
    <div class="menu"><div class="menu-head"><button class="btn" data-a="nav" data-v="floor">← Zal</button><input id="search" placeholder="Taom qidirish..." value="${esc(S.search)}"></div><div class="products" id="products"></div></div>
    <div class="ticket" id="ticket"></div>
    <div class="mobile-switch"><button class="btn block ${S.pane === 'menu' ? 'primary' : ''}" data-a="pane" data-v="menu">Menyu</button><button class="btn block ${S.pane === 'ticket' ? 'primary' : ''}" data-a="pane" data-v="ticket" id="ticket-switch">Buyurtma</button></div>
  </div>`;
  renderCats(); renderProducts(); renderTicket();
}
A.pane = (el) => { S.pane = el.dataset.v; renderView(); };

function renderCats() {
  $('#cats').innerHTML = S.boot.categories.map((c) => `<button style="--c:${esc(c.color)}" class="${c.id === S.cat && !S.search ? 'on' : ''}" data-a="cat" data-id="${c.id}">${esc(c.name)}</button>`).join('');
}
A.cat = (el) => { S.cat = Number(el.dataset.id); S.search = ''; const s = $('#search'); if (s) s.value = ''; renderCats(); renderProducts(); };

function renderProducts() {
  const box = $('#products'); if (!box) return;
  const q = S.search.trim().toLowerCase();
  const colors = Object.fromEntries(S.boot.categories.map((c) => [c.id, c.color]));
  const list = S.boot.products.filter((p) => q ? p.name.toLowerCase().includes(q) : p.category_id === S.cat);
  box.innerHTML = list.map((p) => `<button class="product ${p.in_stop ? 'stop' : ''}" style="--c:${esc(colors[p.category_id])}" data-a="add" data-id="${p.id}">
    <span class="p-name">${esc(p.name)}</span><span class="p-price num">${p.in_stop ? 'STOP' : money(p.price)}</span>
    ${S.boot.modifiers.length && !p.in_stop ? `<span class="more" data-a="addmore" data-id="${p.id}">⋯</span>` : ''}</button>`).join('') || '<p class="muted">Topilmadi</p>';
}

A.add = (el) => {
  const p = S.boot.products.find((x) => x.id === Number(el.dataset.id));
  if (p.in_stop) return toast(`"${p.name}" stop-listda`, true);
  run(async () => { upsertOrder(await api('POST', `/api/orders/${S.orderId}/items`, { product_id: p.id, qty: 1 })); renderTicket(); });
};
A.addmore = async (el) => {
  const p = S.boot.products.find((x) => x.id === Number(el.dataset.id));
  const r = await modal(`<h2>${esc(p.name)}</h2><label>Soni</label><input name="qty" type="number" inputmode="numeric" value="1" min="1">
    <label>Modifikatorlar</label><div class="pick">${S.boot.modifiers.map((m) => `<button data-m="toggle" data-v="${m.id}">${esc(m.name)}${m.price ? `<div class="muted small">+${money(m.price)}</div>` : ''}</button>`).join('')}</div>
    <label>Izoh oshxonaga</label><input name="comment" placeholder="masalan: tezroq">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Qo'shish</button></div>`);
  if (!r) return;
  run(async () => { upsertOrder(await api('POST', `/api/orders/${S.orderId}/items`, { product_id: p.id, qty: Number(r.qty) || 1, modifier_ids: r._on.map(Number), comment: r.comment })); renderTicket(); });
};

function renderTicket() {
  const box = $('#ticket'); if (!box) return;
  const o = curOrder();
  if (!o) { box.innerHTML = '<p class="muted" style="padding:16px">Buyurtma topilmadi</p>'; return; }
  const sw = $('#ticket-switch'); if (sw) sw.textContent = `Buyurtma · ${money(o.total)}`;
  const fresh = o.items.filter((i) => i.status === 'new');
  const sent = o.items.filter((i) => i.status !== 'new');
  const locked = o.precheck_at && S.user.role === 'ofitsiant';
  const foreign = S.user.role === 'ofitsiant' && o.waiter_id !== S.user.id;
  const itemRow = (i) => {
    const mods = JSON.parse(i.modifiers || '[]');
    const [st, cls] = STATUS[i.status];
    return `<div class="item ${i.status === 'cancelled' ? 'cancelled' : ''}">
      <div class="grow"><div class="i-name">${esc(i.name)}</div>
        <div class="i-sub">${mods.length ? '+ ' + esc(mods.map((m) => m.name).join(', ')) + ' · ' : ''}${i.comment ? '«' + esc(i.comment) + '» · ' : ''}${money(i.price + i.mod_price)}${i.status !== 'new' ? ` · <span class="chip ${cls}">${st}</span>` : ''}</div></div>
      ${i.status === 'new' && !locked && !foreign
        ? `<div class="qty"><button data-a="qty" data-id="${i.id}" data-d="-1">−</button><b>${i.qty}</b><button data-a="qty" data-id="${i.id}" data-d="1">+</button></div>`
        : `<b class="num">×${i.qty}</b>`}
      ${i.status === 'ready' && can('admin', 'menejer', 'kassir', 'ofitsiant') ? `<button class="btn sm" data-a="served" data-id="${i.id}">Berildi</button>` : ''}
      ${!['new', 'cancelled'].includes(i.status) && can(...CASHR) ? `<button class="btn sm danger" data-a="cancelItem" data-id="${i.id}" title="Bekor qilish">✕</button>` : ''}
    </div>`;
  };
  box.innerHTML = `
    <div class="t-head"><div class="row"><b style="font-size:18px">${esc(oname(o))} · #${o.number}</b><div class="grow"></div>
      <button class="btn sm" data-a="guests">👥 ${o.guests}</button></div>
      <div class="muted small">${esc(o.waiter_name)} · ochilgan ${hhmm(o.created_at)} ${o.precheck_at ? '· <span class="chip warn">Pre-chek chiqarilgan</span>' : ''}</div>
      ${HOOKS.ticketCustomer ? HOOKS.ticketCustomer(o) : ''}</div>
    <div class="t-items">
      ${fresh.length ? `<div class="t-group">Yangi — hali yuborilmagan</div>${fresh.map(itemRow).join('')}` : ''}
      ${sent.length ? `<div class="t-group">Oshxonada</div>${sent.map(itemRow).join('')}` : ''}
      ${!o.items.length ? '<p class="muted" style="padding:10px">Menyudan taom tanlang</p>' : ''}
    </div>
    <div class="t-foot">
      <div class="sumrow"><span>Jami</span><span class="num">${money(o.subtotal)}</span></div>
      ${o.discount ? `<div class="sumrow"><span>Chegirma ${o.discount_percent ? o.discount_percent + '%' : ''}</span><span class="num">−${money(o.discount)}</span></div>` : ''}
      ${o.service_percent ? `<div class="sumrow"><span>Xizmat haqi ${o.service_percent}%</span><span class="num">${money(o.service)}</span></div>` : ''}
      <div class="sumrow total"><span>To'lov</span><span class="num">${som(o.total)}</span></div>
      <div class="actions">
        ${fresh.length ? `<button class="btn primary" style="grid-column:1/-1" data-a="send">Oshxonaga yuborish (${fresh.reduce((s, i) => s + i.qty, 0)})</button>` : ''}
        <button class="btn" data-a="precheck" ${fresh.length || !sent.length ? 'disabled' : ''}>Pre-chek</button>
        <button class="btn" data-a="more">Amallar ▾</button>
        ${can(...CASHR) ? `<button class="btn primary" style="grid-column:1/-1" data-a="pay" ${fresh.length || !sent.some((i) => i.status !== 'cancelled') ? 'disabled' : ''}>To'lov qabul qilish</button>` : ''}
      </div>
    </div>`;
}

A.qty = (el) => {
  const o = curOrder(); const it = o.items.find((i) => i.id === Number(el.dataset.id));
  run(async () => { upsertOrder(await api('PATCH', `/api/items/${it.id}`, { qty: it.qty + Number(el.dataset.d) })); renderTicket(); });
};
A.guests = async () => {
  const v = await ask('Mehmonlar soni', 'Soni', { type: 'number', value: curOrder().guests }); if (!v) return;
  run(async () => { upsertOrder(await api('PATCH', `/api/orders/${S.orderId}`, { guests: Number(v) })); renderTicket(); });
};
A.send = () => run(async () => {
  const r = await api('POST', `/api/orders/${S.orderId}/send`); upsertOrder(r.order); renderTicket();
  const failed = r.prints.filter((p) => !p.ok);
  toast('Oshxonaga yuborildi'); failed.forEach((p) => toast(`${p.workshop} printeri: ${p.reason}`, true));
});
A.served = (el) => run(async () => { await api('POST', `/api/items/${el.dataset.id}/status`, { status: 'served' }); });
A.cancelItem = async (el) => {
  const it = curOrder().items.find((i) => i.id === Number(el.dataset.id));
  const cooked = ['cooking', 'ready', 'served'].includes(it.status);
  const r = await modal(`<h2>"${esc(it.name)}" ni bekor qilish</h2><label>Sababi (jurnalga yoziladi)</label><input name="reason">
    <label style="display:flex;gap:10px;align-items:center;margin-top:14px;color:var(--text)"><input type="checkbox" name="writeoff" style="width:22px;height:22px" ${cooked ? 'checked' : ''}>
    Masalliqlar ombordan hisobdan chiqarilsin (taom tayyorlab bo'lingan)</label>
    <div class="foot"><button class="btn" data-m="close">Orqaga</button><button class="btn danger" data-m="ok">Bekor qilish</button></div>`);
  if (!r) return;
  if (!r.reason.trim()) return toast('Sabab kiritilmadi', true);
  run(async () => { upsertOrder(await api('POST', `/api/items/${it.id}/cancel`, { reason: r.reason, writeoff: r.writeoff })); renderTicket(); toast('Bekor qilindi'); });
};
A.precheck = () => run(async () => {
  const o = await api('POST', `/api/orders/${S.orderId}/precheck`); upsertOrder(o); renderTicket(); printReceipt(o, true);
});

A.more = async () => {
  const o = curOrder();
  const items = [['move', "Stolga ko'chirish"], ['merge', 'Boshqa chekni qo\'shish'], ['split', "Chekni bo'lish"]];
  if (can(...CASHR)) items.push(['discount', 'Chegirma'], ['service', 'Xizmat haqi'], ...(o.precheck_at ? [['unprecheck', 'Pre-chekni bekor qilish']] : []));
  items.push(['print', 'Chekni chop etish'], ['comment', 'Buyurtmaga izoh'], ['cancelOrder', 'Buyurtmani bekor qilish']);
  const v = await modal(`<h2>Amallar · #${o.number}</h2><div class="pick">${items.map(([k, n]) => `<button data-m="val" data-v="${k}" ${k === 'cancelOrder' ? 'style="color:var(--danger)"' : ''}>${n}</button>`).join('')}</div>
    <div class="foot"><button class="btn" data-m="close">Yopish</button></div>`);
  if (v) OA[v](o);
};
const OA = {
  async move(o) {
    const v = await modal(`<h2>Qaysi stolga?</h2>${S.boot.halls.map((h) => `<label>${esc(h.name)}</label><div class="pick">${S.boot.tables.filter((t) => t.hall_id === h.id && t.id !== o.table_id)
      .map((t) => `<button data-m="val" data-v="${t.id}">${esc(t.name)}${tableOrders(t.id).length ? ' <span class="chip ok">band</span>' : ''}</button>`).join('')}</div>`).join('')}
      <div class="foot"><button class="btn" data-m="close">Bekor</button></div>`, { wide: true });
    if (v) run(async () => { upsertOrder(await api('POST', `/api/orders/${o.id}/move`, { table_id: Number(v) })); renderTicket(); toast("Ko'chirildi"); });
  },
  async merge(o) {
    const others = S.orders.filter((x) => x.id !== o.id && (S.user.role !== 'ofitsiant' || x.waiter_id === S.user.id));
    if (!others.length) return toast("Qo'shiladigan boshqa ochiq chek yo'q", true);
    const v = await modal(`<h2>Qaysi chek shu chekka qo'shilsin?</h2><div class="pick">${others.map((x) => `<button data-m="val" data-v="${x.id}"><b>${esc(oname(x))} · #${x.number}</b><div class="muted small">${som(x.total)}</div></button>`).join('')}</div>
      <div class="foot"><button class="btn" data-m="close">Bekor</button></div>`);
    if (v) run(async () => { upsertOrder(await api('POST', `/api/orders/${o.id}/merge`, { from_order_id: Number(v) })); await loadOrders(); renderTicket(); toast('Birlashtirildi'); });
  },
  async split(o) {
    const live = o.items.filter((i) => !['cancelled', 'new'].includes(i.status));
    if (!live.length) return toast("Bo'lish uchun yuborilgan taom yo'q", true);
    const r = await modal(`<h2>Yangi chekka o'tadigan taomlar</h2><p class="muted small">Har biri uchun nechta o'tishini yozing (0 — qoladi)</p>
      <table class="list">${live.map((i) => `<tr><td>${esc(i.name)}<div class="muted small">${i.qty} ta</div></td><td style="width:110px"><input name="q${i.id}" type="number" inputmode="numeric" min="0" max="${i.qty}" value="0"></td></tr>`).join('')}</table>
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Bo'lish</button></div>`);
    if (!r) return;
    const items = live.map((i) => ({ id: i.id, qty: Math.min(i.qty, Number(r['q' + i.id]) || 0) })).filter((x) => x.qty > 0);
    if (!items.length) return toast('Hech narsa tanlanmadi', true);
    run(async () => { const res = await api('POST', `/api/orders/${o.id}/split`, { items }); await loadOrders(); renderTicket(); toast(`Yangi chek #${res.to.number} ochildi`); });
  },
  async discount(o) {
    const r = await modal(`<h2>Chegirma</h2><div class="paygrid"><div><label>Foiz (%)</label><input name="percent" type="number" inputmode="numeric" value="${o.discount_percent || 0}"></div>
      <div><label>yoki summa (so'm)</label><input name="amount" type="number" inputmode="numeric" value="${o.discount_amount || 0}"></div></div>
      <label>Sababi (jurnalga yoziladi)</label><input name="reason" value="${esc(o.discount_reason || '')}">
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
    if (r) run(async () => { upsertOrder(await api('POST', `/api/orders/${o.id}/discount`, { percent: Number(r.percent) || 0, amount: Number(r.amount) || 0, reason: r.reason })); renderTicket(); });
  },
  async service(o) {
    const v = await ask('Xizmat haqi', 'Foiz (0 — olib tashlash)', { type: 'number', value: o.service_percent });
    if (v != null) run(async () => { upsertOrder(await api('POST', `/api/orders/${o.id}/service`, { percent: Number(v) })); renderTicket(); });
  },
  async unprecheck(o) {
    const reason = await ask('Pre-chekni bekor qilish', 'Sababi'); if (!reason) return;
    run(async () => { upsertOrder(await api('POST', `/api/orders/${o.id}/precheck/cancel`, { reason })); renderTicket(); });
  },
  print(o) { printReceipt(o, o.status !== 'closed'); },
  async comment(o) {
    const v = await ask('Buyurtmaga izoh', 'Izoh', { value: o.comment || '', required: false });
    if (v != null) run(async () => { upsertOrder(await api('PATCH', `/api/orders/${o.id}`, { comment: v })); renderTicket(); });
  },
  async cancelOrder(o) {
    const sent = o.items.some((i) => !['new', 'cancelled'].includes(i.status));
    let reason = '';
    if (sent) { reason = await ask(`#${o.number} ni bekor qilish`, 'Sababi (jurnalga yoziladi)'); if (!reason) return; }
    else if (!(await confirmBox('Buyurtmani bekor qilish', "Bo'sh buyurtma o'chiriladi", 'Bekor qilish', true))) return;
    run(async () => { await api('POST', `/api/orders/${o.id}/cancel`, { reason }); await loadOrders(); S.view = 'floor'; render(); toast('Buyurtma bekor qilindi'); });
  },
};

// To'lov oynasi
A.pay = async () => {
  const o = curOrder();
  const PM = [...METHODS];
  if (o.deposit > 0) PM.push(['zaklad', `Zaklad (${money(o.deposit)})`]);
  if (o.customer_id && o.customer_bonus > 0) PM.push(['bonus', `Bonus (mavjud ${money(o.customer_bonus)})`]);
  const html = `<h2>To'lov · ${esc(oname(o))} #${o.number}</h2><div class="bigtotal num">${som(o.total)}</div>
    <div class="paygrid">${PM.map(([k, n]) => `<div><label>${n}</label><input name="${k}" type="number" inputmode="numeric" min="0" placeholder="0" data-pay ${k === 'zaklad' ? `value="${Math.min(o.deposit, o.total)}"` : ''}></div>`).join('')}</div>
    <div class="row wrap" style="margin-top:10px">
      <button class="btn sm" data-q="all-naqd">Hammasi naqd</button><button class="btn sm" data-q="all-karta">Hammasi karta</button>
      <button class="btn sm" data-q="all-click">Click</button><button class="btn sm" data-q="all-payme">Payme</button>
      ${[50000, 100000, 200000].map((n) => `<button class="btn sm" data-q="+${n}">+${money(n)} naqd</button>`).join('')}
      <button class="btn sm ghost" data-q="clear">Tozalash</button></div>
    <div class="sumrow total" style="margin-top:14px"><span id="pay-label">Qoldi</span><span id="pay-rest" class="num"></span></div>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok" id="pay-ok">To'lovni yakunlash</button></div>`;
  const p = modal(html);
  const ov = document.querySelector('.overlay:last-child');
  const inputs = () => Object.fromEntries(PM.map(([k]) => [k, ov.querySelector(`[name="${k}"]`)]));
  const recalc = () => {
    const vals = Object.fromEntries(Object.entries(inputs()).map(([k, el]) => [k, Number(el.value) || 0]));
    const paid = Object.values(vals).reduce((s, v) => s + v, 0);
    const rest = o.total - paid;
    ov.querySelector('#pay-label').textContent = rest > 0 ? 'Qoldi' : 'Qaytim';
    ov.querySelector('#pay-rest').textContent = som(Math.abs(rest));
    ov.querySelector('#pay-rest').style.color = rest > 0 ? 'var(--warn)' : 'var(--accent)';
    ov.querySelector('#pay-ok').disabled = rest > 0;
  };
  ov.addEventListener('input', recalc);
  ov.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]')?.dataset.q; if (!q) return;
    const ins = inputs();
    const fixed = (Number(ins.zaklad?.value) || 0) + (Number(ins.bonus?.value) || 0);
    if (q === 'clear') METHODS.forEach(([k]) => (ins[k].value = ''));
    else if (q.startsWith('all-')) { METHODS.forEach(([k]) => (ins[k].value = '')); ins[q.slice(4)].value = Math.max(0, o.total - fixed); }
    else ins.naqd.value = (Number(ins.naqd.value) || 0) + Number(q.slice(1));
    recalc();
  });
  recalc();
  const r = await p;
  if (!r) return;
  const payments = PM.map(([k]) => ({ method: k, amount: Number(r[k]) || 0 })).filter((x) => x.amount > 0);
  run(async () => {
    const res = await api('POST', `/api/orders/${o.id}/pay`, { payments });
    upsertOrder(res.order); S.view = 'floor'; render();
    const fz = res.fiscal;
    const done = await modal(`<h2>To'lov qabul qilindi ✓</h2><div class="bigtotal num">${som(res.order.total)}</div>
      ${res.bonus ? `<p class="muted">Mijoz bonusi: ${res.bonus.spent ? `−${money(res.bonus.spent)} · ` : ''}+${money(res.bonus.earned)} · qoldiq <b>${money(res.bonus.balance)}</b></p>` : ''}
      ${res.change ? `<div class="panel"><div class="muted">Qaytim</div><div class="v" style="font-size:28px;font-weight:800">${som(res.change)}</div></div>` : ''}
      <p class="muted small">Fiskal: ${esc({ skipped: "o'chirilgan", ok: 'yuborildi', warning: 'ogohlantirish', not_configured: 'provayder ulanmagan', error: 'xatolik' }[fz.status] || fz.status)}${fz.ref ? ' · ' + esc(fz.ref) : ''}${fz.note ? ' · ' + esc(fz.note) : ''}</p>
      <div class="foot"><button class="btn" data-m="val" data-v="print">Chek chop etish</button><button class="btn primary" data-m="close">Tayyor</button></div>`);
    if (done === 'print') printReceipt(res.order, false);
  });
};

function printReceipt(o, isPre) {
  const b = S.boot.business;
  const live = o.items.filter((i) => i.status !== 'cancelled');
  $('#print-area').innerHTML = `<div class="c b">${esc(b.name)}</div><div class="c">${isPre ? 'HISOB (pre-chek)' : 'CHEK'}</div>
    <div class="r"><span>#${o.number} ${esc(oname(o))}</span><span>${dt(o.closed_at || new Date().toISOString())}</span></div>
    <div>Ofitsiant: ${esc(o.waiter_name || '')} · Mehmon: ${o.guests}</div><hr>
    ${live.map((i) => `<div>${esc(i.name)}</div><div class="r"><span>${i.qty} x ${money(i.price + i.mod_price)}</span><span>${money((i.price + i.mod_price) * i.qty)}</span></div>`).join('')}<hr>
    <div class="r"><span>Jami</span><span>${money(o.subtotal)}</span></div>
    ${o.discount ? `<div class="r"><span>Chegirma</span><span>-${money(o.discount)}</span></div>` : ''}
    ${o.service ? `<div class="r"><span>Xizmat haqi ${o.service_percent}%</span><span>${money(o.service)}</span></div>` : ''}
    <div class="r b"><span>TO'LOV</span><span>${money(o.total)}</span></div>
    ${o.customer_name || o.customer_phone ? `<div>Mijoz: ${esc(o.customer_name || '')} ${esc(o.customer_phone || '')}</div>` : ''}
    ${(o.payments || []).map((p) => `<div class="r"><span>${METHOD_NAME[p.method] || p.method}</span><span>${money(p.amount)}</span></div>`).join('')}
    <hr><div class="c">${esc(b.receipt_footer || '')}</div>`;
  window.print();
}

// ---------- OSHXONA ----------
async function loadKitchen() { S.kitchen = await api('GET', '/api/kitchen' + (S.ws ? '?workshop_id=' + S.ws : '')).catch(() => []); }

function viewKitchen(main) {
  const cols = [['sent', 'Yangi'], ['cooking', 'Tayyorlanmoqda'], ['ready', 'Tayyor — olib ketish kutilmoqda']];
  const cook = can('admin', 'menejer', 'oshpaz');
  const groups = (st) => {
    const g = {};
    S.kitchen.filter((i) => i.status === st).forEach((i) => { (g[i.order_id + '|' + i.sent_at] ||= []).push(i); });
    return Object.values(g);
  };
  main.innerHTML = `<div class="row wrap" style="margin-bottom:14px">
      <button class="btn ${!S.ws ? 'primary' : ''}" data-a="ws" data-id="">Hammasi</button>
      ${S.boot.workshops.map((w) => `<button class="btn ${String(w.id) === String(S.ws) ? 'primary' : ''}" data-a="ws" data-id="${w.id}">${esc(w.name)}</button>`).join('')}
      <div class="grow"></div>${can('admin', 'menejer', 'oshpaz', 'kassir') ? '<button class="btn warn" data-a="stoplist">Stop-list</button>' : ''}</div>
    <div class="kds">${cols.map(([st, title]) => {
      const gs = groups(st);
      return `<div class="kcol"><h3>${title}<span class="chip">${gs.reduce((s, g) => s + g.length, 0)}</span></h3>
        ${gs.map((items) => { const f = items[0]; return `<div class="kcard ${st === 'ready' ? 'ready' : ''}" ${st !== 'ready' ? `data-sent="${f.sent_at}"` : ''}>
          <div class="k-head"><span>#${f.number} · ${esc(f.table_name || (f.delivery_id ? '🛵 Yetkazib berish' : ''))}</span><span class="num" data-since="${f.sent_at}">${ago(f.sent_at)}</span></div>
          <div class="muted small" style="margin:-4px 0 8px">${esc(f.waiter_name || '')}</div>
          ${items.map((i) => { const mods = JSON.parse(i.modifiers || '[]'); return `<button class="kitem" ${cook && st !== 'ready' ? `data-a="kstep" data-id="${i.id}" data-to="${st === 'sent' ? 'cooking' : 'ready'}"` : ''}>
            <span class="kq">${i.qty}×</span><span class="grow"><b>${esc(i.name)}</b>${mods.length ? `<div class="kmod">+ ${esc(mods.map((m) => m.name).join(', '))}</div>` : ''}${i.comment ? `<div class="kcom">! ${esc(i.comment)}</div>` : ''}</span></button>`; }).join('')}
          ${cook && st !== 'ready' ? `<button class="btn ${st === 'sent' ? '' : 'primary'} block sm" data-a="kall" data-ids="${items.map((i) => i.id).join(',')}" data-to="${st === 'sent' ? 'cooking' : 'ready'}">${st === 'sent' ? 'Hammasini boshlash' : 'Hammasi tayyor'}</button>` : ''}
        </div>`; }).join('') || '<p class="muted">—</p>'}</div>`;
    }).join('')}</div>`;
}
A.ws = (el) => { S.ws = el.dataset.id; loadKitchen().then(renderView); };
A.kstep = (el) => run(async () => { await api('POST', `/api/items/${el.dataset.id}/status`, { status: el.dataset.to }); });
A.kall = (el) => run(async () => { for (const id of el.dataset.ids.split(',')) await api('POST', `/api/items/${id}/status`, { status: el.dataset.to }); });
A.stoplist = async () => {
  const r = await modal(`<h2>Stop-list</h2><p class="muted small">Belgilangan taomlar tugagan — ofitsiant qo'sha olmaydi</p>
    ${S.boot.categories.map((c) => `<label>${esc(c.name)}</label><div class="pick">${S.boot.products.filter((p) => p.category_id === c.id)
      .map((p) => `<button data-m="toggle" data-v="${p.id}" class="${p.in_stop ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>`).join('')}
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`, { wide: true });
  if (!r) return;
  const on = new Set(r._on.map(Number));
  run(async () => {
    for (const p of S.boot.products) if (!!p.in_stop !== on.has(p.id)) await api('POST', `/api/products/${p.id}/stop`, { in_stop: on.has(p.id) });
    toast('Stop-list yangilandi');
  });
};

// ---------- KASSA VA SMENA ----------
async function viewCash(main) {
  main.innerHTML = '<p class="muted">Yuklanmoqda...</p>';
  const [rep, shifts] = await Promise.all([api('GET', '/api/shift'), api('GET', '/api/shifts')]).catch((e) => { toast(e.message, true); return [null, []]; });
  if (S.view !== 'cash') return;
  if (!rep) {
    main.innerHTML = `<div class="panel" style="max-width:460px"><h3>Smenani ochish</h3><p class="muted">Kassadagi boshlang'ich naqd pulni kiriting.</p>
      <label>Boshlang'ich naqd (so'm)</label><input id="open-cash" type="number" inputmode="numeric" value="0">
      <button class="btn primary block" style="margin-top:14px" data-a="openShift">Smenani ochish</button></div>${shiftHistory(shifts)}`;
    return;
  }
  main.innerHTML = `<div class="row wrap" style="margin-bottom:14px"><h2 style="margin:0">Joriy smena</h2><span class="muted">ochildi ${dt(rep.shift.opened_at)}</span><div class="grow"></div>
      <button class="btn" data-a="cashMove" data-t="in">+ Kassaga kirim</button><button class="btn" data-a="cashMove" data-t="out">− Kassadan chiqim</button>
      <button class="btn" data-a="printX">X-hisobot</button><button class="btn danger" data-a="closeShift">Smenani yopish</button></div>
    ${reportHtml(rep)}${shiftHistory(shifts)}`;
  S.lastReport = rep;
}
function reportHtml(r) {
  const st = (n, v, extra = '') => `<div class="stat"><div class="muted small">${n}</div><div class="v">${v}</div>${extra}</div>`;
  return `<div class="grid-stats">
      ${st('Tushum', som(r.revenue))}${st('Buyurtmalar', r.orders)}${st("O'rtacha chek", som(r.avg))}${st('Mehmonlar', r.guests)}
      ${REPORT_METHODS.map(([k, n]) => (['onlayn', 'kuryer'].includes(k) && !r.byMethod[k] ? '' : st(n, som(r.byMethod[k])))).join('')}
      ${r.byMethod.zaklad ? st('Zaklad hisobidan', som(r.byMethod.zaklad)) : ''}${r.byMethod.bonus ? st('Bonus hisobidan', som(r.byMethod.bonus)) : ''}
      ${st('Chegirmalar', som(r.discounts))}${st('Xizmat haqi', som(r.service))}
      ${st('Kutilgan naqd (kassada)', som(r.expectedCash), `<div class="muted small">boshl. ${money(r.shift.opening_cash)} + naqd ${money(r.byMethod.naqd)} + kirim ${money(r.cashIn)} − chiqim ${money(r.cashOut)}</div>`)}
      ${r.shift.status === 'closed' ? st('Sanalgan naqd', som(r.shift.counted_cash), `<div class="small" style="color:${r.shift.counted_cash - r.shift.expected_cash < 0 ? 'var(--danger)' : 'var(--accent)'}">Farq: ${money(r.shift.counted_cash - r.shift.expected_cash)}</div>`) : st('Ochiq buyurtmalar', r.openOrders)}
    </div>
    <div class="row wrap" style="align-items:flex-start">
      <div class="panel grow" style="min-width:300px"><h3>Eng ko'p sotilgan</h3><table class="list"><tr><th>Taom</th><th class="right">Soni</th><th class="right">Summa</th></tr>
        ${r.top.map((t) => `<tr><td>${esc(t.name)}</td><td class="right">${t.qty}</td><td class="right num">${money(t.sum)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}</table></div>
      <div class="panel grow" style="min-width:300px"><h3>Bekor qilinganlar <span class="chip danger">${som(r.cancelledSum)}</span></h3><table class="list"><tr><th>Taom</th><th>Sabab</th><th class="right">Summa</th></tr>
        ${r.cancelledItems.map((c) => `<tr><td>${esc(c.name)} ×${c.qty}</td><td class="muted">${esc(c.cancel_reason)}</td><td class="right num">${money(c.sum)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}</table>
        ${r.moves.length ? `<h3 style="margin-top:14px">Kassa harakatlari</h3><table class="list">${r.moves.map((m) => `<tr><td>${m.type === 'in' ? '+' : '−'} ${money(m.amount)}</td><td class="muted">${esc(m.note)}</td><td class="right muted">${hhmm(m.at)}</td></tr>`).join('')}</table>` : ''}</div>
    </div>`;
}
function shiftHistory(shifts) {
  const closed = shifts.filter((s) => s.status === 'closed');
  if (!closed.length) return '';
  return `<div class="panel"><h3>Oldingi smenalar</h3><table class="list"><tr><th>#</th><th>Ochildi</th><th>Yopildi</th><th class="right">Farq</th><th></th></tr>
    ${closed.map((s) => `<tr><td>${s.id}</td><td>${dt(s.opened_at)}</td><td>${dt(s.closed_at)}</td><td class="right num" style="color:${s.counted_cash - s.expected_cash < 0 ? 'var(--danger)' : ''}">${money(s.counted_cash - s.expected_cash)}</td>
    <td class="right"><button class="btn sm" data-a="shiftView" data-id="${s.id}">Z-hisobot</button></td></tr>`).join('')}</table></div>`;
}
A.openShift = () => run(async () => { await api('POST', '/api/shift/open', { opening_cash: Number($('#open-cash').value) || 0 }); await loadBoot(); render(); toast('Smena ochildi'); });
A.cashMove = async (el) => {
  const t = el.dataset.t;
  const r = await modal(`<h2>${t === 'in' ? 'Kassaga kirim' : 'Kassadan chiqim'}</h2><label>Summa</label><input name="amount" type="number" inputmode="numeric"><label>Izoh (nima uchun)</label><input name="note">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
  if (r) run(async () => { await api('POST', '/api/shift/cash', { type: t, amount: Number(r.amount), note: r.note }); renderView(); });
};
A.closeShift = async () => {
  const r = S.lastReport;
  const v = await ask('Smenani yopish', `Kassadagi naqd pulni sanab kiriting (kutilgan: ${som(r.expectedCash)})`, { type: 'number' });
  if (v == null) return;
  run(async () => { const rep = await api('POST', '/api/shift/close', { counted_cash: Number(v) }); await loadBoot(); await loadOrders(); render(); showZ(rep); });
};
A.shiftView = (el) => run(async () => showZ(await api('GET', `/api/shifts/${el.dataset.id}`)));
A.printX = () => printReport(S.lastReport, 'X-HISOBOT');
async function showZ(rep) {
  const v = await modal(`<h2>Z-hisobot · smena #${rep.shift.id}</h2>${reportHtml(rep)}<div class="foot"><button class="btn" data-m="val" data-v="p">Chop etish</button><button class="btn primary" data-m="close">Yopish</button></div>`, { wide: true });
  if (v === 'p') printReport(rep, 'Z-HISOBOT');
}
function printReport(r, title) {
  $('#print-area').innerHTML = `<div class="c b">${esc(S.boot.business.name)}</div><div class="c">${title} · smena #${r.shift.id}</div>
    <div>Ochildi: ${dt(r.shift.opened_at)}</div>${r.shift.closed_at ? `<div>Yopildi: ${dt(r.shift.closed_at)}</div>` : ''}<hr>
    <div class="r"><span>Tushum</span><span>${money(r.revenue)}</span></div><div class="r"><span>Buyurtmalar</span><span>${r.orders}</span></div>
    ${REPORT_METHODS.map(([k, n]) => `<div class="r"><span>${n}</span><span>${money(r.byMethod[k])}</span></div>`).join('')}<hr>
    <div class="r"><span>Chegirmalar</span><span>${money(r.discounts)}</span></div><div class="r"><span>Bekor qilingan</span><span>${money(r.cancelledSum)}</span></div>
    <div class="r"><span>Kirim / chiqim</span><span>${money(r.cashIn)} / ${money(r.cashOut)}</span></div>
    <div class="r b"><span>Kutilgan naqd</span><span>${money(r.expectedCash)}</span></div>
    ${r.shift.counted_cash != null ? `<div class="r"><span>Sanalgan</span><span>${money(r.shift.counted_cash)}</span></div><div class="r b"><span>Farq</span><span>${money(r.shift.counted_cash - r.shift.expected_cash)}</span></div>` : ''}`;
  window.print();
}

// ---------- BOSHQARUV (admin) ----------
const ADMIN_TABS = [['products', 'Menyu'], ['categories', 'Kategoriyalar'], ['modifiers', 'Modifikatorlar'], ['tables', 'Stollar'], ['halls', 'Zallar'], ['workshops', 'Sexlar va printerlar'], ['users', 'Xodimlar'], ['settings', 'Sozlamalar'], ['audit', 'Jurnal']];
const opts = (list, label = 'name') => list.map((x) => [x.id, x[label]]);
const FORMS = {
  products: () => [['name', 'Nomi'], ['price', 'Narxi (so\'m)', 'number'], ['category_id', 'Kategoriya', opts(S.boot.categories)], ['workshop_id', 'Sex (qayerda tayyorlanadi)', opts(S.boot.workshops)],
    ['mxik', 'MXIK kodi (fiskal chek uchun)'], ['unit', "O'lchov birligi"], ['sort', 'Tartib', 'number'],
    ['delivery', 'Ilovada sotiladi (yetkazib berish)', 'bool'], ['non_returnable', "Qaytarib bo'lmaydi (tayyor taom) — qimmat buyurtmada 100% oldindan to'lov", 'bool'], ['image', 'Rasm (mijoz ilovasi uchun)', 'img'],
    ['sold_by', 'Qanday sotiladi', [['dona', 'Dona / porsiya'], ['kg', "Og'irlik bilan (narx — 1 kg uchun)"]]], ['step_g', "Og'irlik qadami, gramm (ilovada; masalan 250)", 'number'],
    ['barcode', 'Shtrix-kod (skaner uchun)'], ['rx', 'Retsept bilan beriladi (dorixona) — ilovada sotilmaydi', 'bool0']],
  categories: () => [['name', 'Nomi'], ['color', 'Rangi', 'color'], ['sort', 'Tartib', 'number']],
  modifiers: () => [['name', 'Nomi'], ['price', "Qo'shimcha narx", 'number']],
  tables: () => [['name', 'Nomi'], ['hall_id', 'Zal', opts(S.boot.halls)], ['seats', "O'rinlar", 'number'], ['sort', 'Tartib', 'number']],
  halls: () => [['name', 'Nomi'], ['sort', 'Tartib', 'number']],
  workshops: () => [['name', 'Nomi'], ['printer', 'Printer IP (masalan 192.168.1.50:9100)']],
  users: () => [['name', 'Ismi'], ['role', 'Roli', Object.entries(ROLE_NAME)], ['pin', 'PIN (4 raqam; o\'zgartirmaslik uchun bo\'sh qoldiring)'],
    ['pay_type', 'Maosh turi', [['none', 'Belgilanmagan'], ['hourly', 'Soatbay'], ['monthly', 'Oylik']]], ['rate', "Stavka (soatiga yoki oyiga, so'm)", 'number'],
    ['percent', 'Foiz (%)', 'number'], ['percent_base', 'Foiz nimadan', [['sales', "O'z sotuvidan (chegirmadan keyin)"], ['service', 'Xizmat haqidan']]]],
};
const COLS = {
  products: [['image', '', (v) => v ? `<img class="thumb" src="${esc(DX.asset(v))}" alt="">` : ''], ['name', 'Nomi'], ['price', 'Narx', (v) => money(v)], ['category_id', 'Kategoriya', (v) => S.boot.categories.find((c) => c.id === v)?.name], ['workshop_id', 'Sex', (v) => S.boot.workshops.find((w) => w.id === v)?.name], ['mxik', 'MXIK'], ['delivery', 'Ilova', (v) => v ? '🛵' : ''], ['in_stop', 'Stop', (v) => v ? '<span class="chip danger">STOP</span>' : '']],
  categories: [['name', 'Nomi'], ['color', 'Rang', (v) => `<span class="chip" style="border-color:${esc(v)};color:${esc(v)}">■</span>`]],
  modifiers: [['name', 'Nomi'], ['price', 'Narx', (v) => money(v)]],
  tables: [['name', 'Nomi'], ['hall_id', 'Zal', (v) => S.boot.halls.find((h) => h.id === v)?.name], ['seats', "O'rin"]],
  halls: [['name', 'Nomi']],
  workshops: [['name', 'Nomi'], ['printer', 'Printer']],
  users: [['name', 'Ismi'], ['role', 'Rol', (v) => ROLE_NAME[v]], ['pay_type', 'Maosh', (v, r) => ({ hourly: `${money(r.rate)}/soat`, monthly: `${money(r.rate)}/oy`, none: '—' }[v] || '—') + (r.percent ? ` + ${r.percent}%` : '')], ['active', 'Holat', (v) => v ? '<span class="chip ok">faol</span>' : '<span class="chip">o\'chirilgan</span>']],
};
const AUDIT_NAMES = { login: 'Kirdi', order_create: 'Buyurtma ochdi', order_send: 'Oshxonaga yubordi', item_cancel: 'Taomni bekor qildi', order_move: "Stolni ko'chirdi", order_merge: 'Cheklarni birlashtirdi', order_split: "Chekni bo'ldi", order_discount: 'Chegirma berdi', order_service: "Xizmat haqini o'zgartirdi", precheck: 'Pre-chek', precheck_cancel: 'Pre-chekni bekor qildi', order_pay: "To'lov qabul qildi", order_cancel: 'Buyurtmani bekor qildi', shift_open: 'Smena ochdi', shift_close: 'Smena yopdi', cash_in: 'Kassaga kirim', cash_out: 'Kassadan chiqim', stop_on: "Stop-listga qo'shdi", stop_off: 'Stop-listdan chiqardi', create: 'Yaratdi', update: "O'zgartirdi", settings: 'Sozlamalar', invoice: 'Kirim (nakladnoy)', writeoff: 'Hisobdan chiqardi', produce: 'Yarim tayyor tayyorladi', inventory: 'Inventarizatsiya', recipe_save: 'Texkartani saqladi', supplier_pay: "Ta'minotchiga to'ladi", clock_in: 'Ishga keldi', clock_out: 'Ishdan ketdi', time_edit: "Ish vaqtini o'zgartirdi", time_add: "Ish vaqti qo'shdi", payroll_pay: "Maosh/avans to'ladi", customer_attach: 'Mijoz biriktirdi', customer_detach: 'Mijozni olib tashladi', bonus_adjust: "Bonusni o'zgartirdi", reservation_create: 'Bron yaratdi', reservation_edit: "Bronni o'zgartirdi", reservation_arrived: 'Bron: mehmon keldi', reservation_cancelled: 'Bronni bekor qildi', reservation_noshow: 'Bron: kelmadi', backup: 'Zaxira nusxa' };

const ADMIN_VIEWS = {}; // modullar qo'shimcha bo'lim ulaydi (masalan delivery.js)
async function viewAdmin(main) {
  const tab = S.adminTab;
  const head = `<div class="sub-tabs">${ADMIN_TABS.map(([k, n]) => `<button class="btn sm ${k === tab ? 'primary' : ''}" data-a="atab" data-v="${k}">${n}</button>`).join('')}</div>`;
  if (ADMIN_VIEWS[tab]) return ADMIN_VIEWS[tab](main, head);
  if (tab === 'settings') {
    const b = S.boot.business;
    main.innerHTML = head + `<div class="panel" style="max-width:560px"><h3>Restoran sozlamalari</h3>
      <div class="row" style="margin-bottom:6px"><span class="muted">Biznes kodi (planshet va telefonlarni ulash uchun):</span><b style="font-size:20px;letter-spacing:2px">${esc(b.code || '')}</b></div>
      <label>Nomi</label><input id="s-name" value="${esc(b.name)}">
      <label>Standart xizmat haqi (%)</label><input id="s-sp" type="number" value="${b.service_percent}">
      <label>Chek printeri IP (bo'sh — brauzer orqali chop etiladi)</label><input id="s-rp" value="${esc(b.receipt_printer || '')}">
      <label>Chek oxiridagi matn</label><input id="s-rf" value="${esc(b.receipt_footer || '')}">
      <label>Fiskal rejim</label><select id="s-fm"><option value="off" ${b.fiscal_mode === 'off' ? 'selected' : ''}>O'chiq (alohida onlayn kassa ishlatiladi)</option><option value="mock" ${b.fiscal_mode === 'mock' ? 'selected' : ''}>Sinov rejimi</option></select>
      <p class="muted small">Haqiqiy fiskal chek uchun Davlat reestridagi virtual kassa provayderi ulanadi (keyingi bosqich).</p>
      <button class="btn primary" style="margin-top:12px" data-a="saveSettings">Saqlash</button></div>`;
    HOOKS.adminSettings?.(main);
    return;
  }
  if (tab === 'audit') {
    const log = await api('GET', '/api/audit').catch(() => []);
    main.innerHTML = head + `<div class="panel"><h3>Harakatlar jurnali</h3><p class="muted small">Har bir bekor qilish, chegirma, to'lov va o'zgarish shu yerga yoziladi.</p>
      <table class="list"><tr><th>Vaqt</th><th>Xodim</th><th>Amal</th><th>Tafsilot</th></tr>
      ${log.map((l) => `<tr><td class="muted">${dt(l.at)}</td><td>${esc(l.user_name || '')}</td><td>${esc(AUDIT_NAMES[l.action] || l.action)} ${l.entity && !l.action.startsWith('order') ? `<span class="muted small">${esc(l.entity)}</span>` : ''}</td>
        <td class="small muted">${esc(fmtDetails(l.details))}</td></tr>`).join('')}</table></div>`;
    return;
  }
  const rows = await adminRows(tab);
  const cols = COLS[tab];
  main.innerHTML = head + `<div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">${ADMIN_TABS.find((t) => t[0] === tab)[1]}</h3><div class="grow"></div>
    <button class="btn primary" data-a="aedit" data-id="">+ Qo'shish</button></div>
    <table class="list"><tr>${cols.map((c) => `<th>${c[1]}</th>`).join('')}<th></th></tr>
    ${rows.map((r) => `<tr class="${r.active === 0 ? 'off' : ''}">${cols.map(([k, , f]) => `<td>${f ? f(r[k], r) ?? '' : esc(r[k] ?? '')}</td>`).join('')}
      <td class="right"><button class="btn sm" data-a="aedit" data-id="${r.id}">Tahrirlash</button>
      <button class="btn sm ${r.active === 0 ? '' : 'danger'}" data-a="atoggle" data-id="${r.id}" data-on="${r.active === 0 ? 1 : 0}">${r.active === 0 ? 'Tiklash' : "O'chirish"}</button></td></tr>`).join('')}</table></div>`;
}
function fmtDetails(d) {
  if (!d) return '';
  try { const o = JSON.parse(d); return Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); } catch { return d; }
}
async function adminRows(tab) {
  S.adminCache = await api('GET', `/api/admin/${tab}`);
  return S.adminCache;
}
A.atab = (el) => { S.adminTab = el.dataset.v; renderView(); };
A.aedit = async (el) => {
  const tab = S.adminTab;
  const id = Number(el.dataset.id) || null;
  const row = id ? (S.adminCache || []).find((r) => r.id === id) || {} : {};
  const fields = FORMS[tab]();
  const pr = modal(`<h2>${id ? 'Tahrirlash' : "Qo'shish"}</h2>${fields.map(([k, label, t]) => {
    const v = row[k] ?? (t === 'color' ? '#2f855a' : t === 'bool' ? 1 : k === 'step_g' ? 100 : k === 'sold_by' ? 'dona' : '');
    if (t === 'bool' || t === 'bool0') return `<label class="chk"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
    if (t === 'img') return `<label>${label}</label><div class="row imgpick"><img class="thumb lg" src="${esc(DX.asset(v))}" ${v ? '' : 'hidden'} alt="">
      <label class="btn sm" style="margin:0">📷 Tanlash<input type="file" accept="image/*" hidden></label><button class="btn sm ghost" type="button" data-img-clear ${v ? '' : 'hidden'}>O'chirish</button>
      <input type="hidden" name="${k}" value="__keep__"></div><div class="muted small">Rasm avtomatik kichraytiriladi (≈480 px).</div>`;
    if (Array.isArray(t)) return `<label>${label}</label><select name="${k}">${t.map(([ov, on]) => `<option value="${ov}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(on)}</option>`).join('')}</select>`;
    return `<label>${label}</label><input name="${k}" type="${t === 'number' ? 'number' : t === 'color' ? 'color' : 'text'}" value="${k === 'pin' ? '' : esc(v)}" ${t === 'number' ? 'inputmode="numeric"' : ''}>`;
  }).join('')}<div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
  wireImagePicker($('#modal-root .overlay:last-child'));
  const r = await pr;
  if (!r) return;
  const body = { ...(id ? { id } : {}) };
  fields.forEach(([k, , t]) => {
    if (t === 'bool' || t === 'bool0') { body[k] = !!r[k]; return; }
    if (t === 'img') { if (r[k] !== '__keep__') body[k] = r[k]; return; } if (r[k] === '' && (k === 'pin' || k === 'mxik' || k === 'unit' || k === 'printer')) { if (k !== 'pin') body[k] = ''; return; } body[k] = t === 'number' || (Array.isArray(t) && k.endsWith('_id')) ? Number(r[k]) : r[k]; });
  run(async () => { await api('POST', `/api/admin/${tab}`, body); await loadBoot(); renderView(); toast('Saqlandi'); });
};
// Rasm tanlash: brauzerda kichraytirib (webp/jpeg) data URL qilib yuboriladi
function wireImagePicker(ov) {
  const box = ov?.querySelector('.imgpick'); if (!box) return;
  const img = box.querySelector('img'), file = box.querySelector('input[type=file]'), hid = box.querySelector('input[type=hidden]'), clr = box.querySelector('[data-img-clear]');
  clr.onclick = () => { hid.value = ''; img.hidden = true; clr.hidden = true; };
  file.onchange = () => {
    const f = file.files[0]; if (!f) return;
    const fr = new FileReader(), im = new Image(); // blob: URL CSP da yopiq — data URL orqali o'qiymiz
    fr.onload = () => { im.src = fr.result; };
    im.onload = () => {
      const k = Math.min(1, 480 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      let d = c.toDataURL('image/webp', 0.8); if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', 0.8);
      if (d.length > 290000) return toast('Rasm juda katta, boshqasini tanlang', true);
      hid.value = d; img.src = d; img.hidden = false; clr.hidden = false;
    };
    im.onerror = () => toast("Rasmni o'qib bo'lmadi", true);
    if (f.size > 15e6) return toast('Rasm fayli juda katta', true);
    fr.readAsDataURL(f);
  };
}
A.atoggle = (el) => run(async () => { await api('POST', `/api/admin/${S.adminTab}`, { id: Number(el.dataset.id), active: el.dataset.on === '1' }); await loadBoot(); renderView(); });
A.saveSettings = () => run(async () => {
  await api('POST', '/api/admin/settings', { name: $('#s-name').value, service_percent: Number($('#s-sp').value) || 0, receipt_printer: $('#s-rp').value, receipt_footer: $('#s-rf').value, fiscal_mode: $('#s-fm').value });
  await loadBoot(); render(); toast('Saqlandi');
});

// ---------- Boshlash ----------
function boot() {
  if (['#register', '#owner', '#platform'].includes(location.hash) && typeof PLATFORM_UI !== 'undefined') return PLATFORM_UI.route(location.hash);
  if (S.user) return render();
  return S.token ? start() : renderLogin();
}
window.addEventListener('DOMContentLoaded', boot);
window.addEventListener('hashchange', boot);
