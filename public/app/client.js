// Dasturxon — mijoz ilovasi (6-etap): joylar, menyu, savat, to'lov, buyurtma holati. Build'siz vanilla JS.
'use strict';

const APP_NAME = 'Dasturxon';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const som = (n) => money(n) + " so'm";
const hhmm = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dt = (iso) => { if (!iso) return ''; const d = new Date(iso), z = (n) => String(n).padStart(2, '0'); return `${z(d.getDate())}.${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const store = {
  get(k, j) { try { const v = localStorage.getItem(k); return j ? JSON.parse(v || 'null') : v; } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} },
};
const fmtPhone = (p) => (p && p.length === 12 ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : p || '');

const TYPES = [['', 'Hammasi', '✨'], ['restoran', 'Restoran', '🍽'], ['fastfood', 'Fastfud', '🍔'], ['kafe', 'Kafe', '☕'], ['choyxona', 'Choyxona', '🫖'], ['shirinlik', 'Shirinliklar', '🍰']];
const TYPE_ICON = Object.fromEntries(TYPES.map(([k, , i]) => [k, i]));
const ST = {
  awaiting_payment: ["To'lov kutilmoqda", '💳', 'warn'], new: ['Restoran tasdiqlashini kutmoqda', '⏳', 'info'], accepted: ['Tayyorlanmoqda', '👨‍🍳', 'info'],
  ready: ['Tayyor, kuryerga berilmoqda', '📦', 'ok'], on_way: ["Yo'lda", '🛵', 'ok'], delivered: ['Yetkazildi', '✅', 'ok'],
  cancelled: ['Bekor qilindi', '✖️', 'danger'], rejected: ['Restoran rad etdi', '⛔', 'danger'], no_show: ['Buyurtma olinmadi', '🚪', 'danger'],
};
const PROV = { test: "Sinov to'lovi (test)", click: 'Click', payme: 'Payme', cash: 'Naqd — kuryerga' };

const S = { token: store.get('dx_ctoken'), me: null, type: '', places: null, menu: null, cat: null, quote: null, pay: null, payOnline: false, after: '#orders', poll: null, geo: store.get('dx_geo', true) };
const cart = () => store.get('dx_cart', true) || { place: null, place_name: '', items: [] };
const saveCart = (c) => store.set('dx_cart', c.items.length ? c : null);
const cartCount = (c = cart()) => c.items.reduce((t, i) => t + i.qty, 0);
const cartSum = (c = cart()) => c.items.reduce((t, i) => t + i.price * i.qty, 0);

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), err ? 4500 : 2500);
}
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { S.token = null; S.me = null; store.set('dx_ctoken', null); }
  if (!r.ok) { const e = new Error(j.error || 'Xatolik'); e.status = r.status; throw e; }
  return j;
}
const run = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

function topbar(title, back, right = '') {
  return `<header class="ctop">${back ? `<button class="back" data-a="back" data-v="${back}" aria-label="Orqaga">‹</button>` : ''}<h1>${title}</h1>${right}</header>`;
}
function cartBar() {
  const c = cart(); const n = cartCount(c);
  if (!n || location.hash === '#cart') return '';
  return `<button class="cartbar" data-a="go" data-v="#cart"><span class="n">${n}</span><span class="grow" style="text-align:left">Savat · ${esc(c.place_name)}</span><span>${som(cartSum(c))}</span></button>`;
}
const view = (html, keep) => { const y = window.scrollY; $('#app').innerHTML = html + cartBar(); window.scrollTo(0, keep ? y : 0); };

// ---------- Ekranlar ----------
async function viewHome() {
  const meBtn = `<button class="btn sm" data-a="go" data-v="${S.token ? '#orders' : '#login'}">${S.token ? '🧾 Buyurtmalarim' : 'Kirish'}</button>`;
  view(topbar(`<span style="color:var(--accent)">●</span> ${APP_NAME}`, '', meBtn) + `<div class="chips">${TYPES.map(([k, n, i]) => `<button class="${S.type === k ? 'on' : ''}" data-a="type" data-v="${k}">${i} ${n}</button>`).join('')}</div><div id="list"><div class="empty">Yuklanmoqda…</div></div>`);
  const list = await run(() => api('GET', '/api/c/places' + (S.type ? '?type=' + S.type : '')));
  if (!list) return;
  $('#list').innerHTML = list.length ? list.map((p) => `<button class="place ${p.open ? '' : 'closed'}" data-a="go" data-v="#p/${esc(p.code)}">
    <div class="logo">${TYPE_ICON[p.type] || esc(p.name[0])}</div>
    <div class="grow"><b>${esc(p.name)}</b><div class="muted small">${esc(p.description || p.address || '')}</div>
      <div class="meta"><span>⏱ ${p.prep_minutes}–${p.prep_minutes + 20} daq</span><span>🛵 ${p.delivery_fee ? som(p.delivery_fee) : 'bepul'}</span>${p.min_order ? `<span>min. ${som(p.min_order)}</span>` : ''}
      ${p.open ? '' : '<span class="chip danger">Hozir yopiq</span>'}</div></div></button>`).join('')
    : `<div class="empty"><div class="ic">🍽</div>Hozircha bu turdagi joylar yo'q</div>`;
}

async function viewPlace(code) {
  view(topbar('…', '#') + '<div class="empty">Yuklanmoqda…</div>');
  const m = await run(() => api('GET', '/api/c/places/' + encodeURIComponent(code)));
  if (!m) return go('#');
  S.menu = m;
  if (!m.categories.some((c) => c.id === S.cat)) S.cat = null;
  renderPlace();
}
function renderPlace(keep) {
  const m = S.menu, p = m.place, c = cart();
  const qtyOf = (id) => (c.place === p.code ? c.items.find((i) => i.product_id === id)?.qty : 0) || 0;
  const cats = S.cat ? m.categories.filter((x) => x.id === S.cat) : m.categories;
  const card = (x) => {
    const q = qtyOf(x.id);
    return `<div class="pcard ${x.in_stop ? 'stop' : ''}"><div class="ph" ${x.image ? `style="background-image:url('${esc(x.image)}')"` : ''}>${x.image ? '' : esc(x.name[0])}</div>
      <div class="bd"><div class="nm">${esc(x.name)}</div><div class="pr">${som(x.price)}</div>
      ${x.in_stop ? '<span class="muted small">Hozir mavjud emas</span>' : !p.open ? '' : q
        ? `<div class="step addbtn"><button data-a="qty" data-id="${x.id}" data-d="-1">−</button><span>${q}</span><button data-a="qty" data-id="${x.id}" data-d="1">+</button></div>`
        : `<button class="btn sm primary addbtn" data-a="qty" data-id="${x.id}" data-d="1">+ Savatga</button>`}</div></div>`;
  };
  view(topbar(esc(p.name), '#') + `<div class="hero"><div class="muted">${esc(p.description || '')}</div>
    <div class="meta"><span class="chip">${TYPE_ICON[p.type] || ''} ${esc(TYPES.find((t) => t[0] === p.type)?.[1] || p.type)}</span><span class="chip">⏱ ${p.prep_minutes}–${p.prep_minutes + 20} daq</span>
    <span class="chip">🛵 ${p.delivery_fee ? som(p.delivery_fee) : 'Bepul yetkazish'}</span>${p.min_order ? `<span class="chip">min. ${som(p.min_order)}</span>` : ''}${p.open ? '' : '<span class="chip danger">Hozir buyurtma qabul qilmayapti</span>'}</div>
    ${p.address ? `<div class="muted small" style="margin-top:8px">📍 ${esc(p.address)}</div>` : ''}</div>
    <div class="chips stickychips"><button class="${!S.cat ? 'on' : ''}" data-a="cat" data-v="">Hammasi</button>${m.categories.map((x) => `<button class="${S.cat === x.id ? 'on' : ''}" data-a="cat" data-v="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    ${cats.map((ct) => `<h3 class="catttl">${esc(ct.name)}</h3><div class="pgrid">${m.products.filter((x) => x.category_id === ct.id).map(card).join('')}</div>`).join('')
      || `<div class="empty"><div class="ic">📋</div>Menyu hali to'ldirilmagan</div>`}`, keep);
}

async function viewCart(keep) {
  const c = cart();
  if (!c.items.length) return view(topbar('Savat', '#') + `<div class="empty"><div class="ic">🛒</div>Savat bo'sh<br><br><button class="btn primary" data-a="go" data-v="#">Joylarni ko'rish</button></div>`);
  const addr = store.get('dx_addr') || '';
  view(topbar('Savat', '#p/' + c.place) + `<div class="csec"><div class="panel"><h3>${esc(c.place_name)}</h3>
    ${c.items.map((i) => `<div class="line"><div class="grow"><div>${esc(i.name)}</div><div class="muted small">${som(i.price)}</div></div>
      <div class="step"><button data-a="cqty" data-id="${i.product_id}" data-d="-1">−</button><span>${i.qty}</span><button data-a="cqty" data-id="${i.product_id}" data-d="1">+</button></div>
      <b class="num" style="min-width:86px;text-align:right">${money(i.price * i.qty)}</b></div>`).join('')}</div>
    <div class="panel"><h3>Yetkazish manzili</h3>
      <textarea id="addr" rows="2" placeholder="Shahar, ko'cha, uy, xonadon, mo'ljal">${esc(addr)}</textarea>
      <button class="btn sm" style="margin-top:8px" data-a="geo">📍 ${S.geo ? 'Joylashuv olindi — yangilash' : 'Joylashuvimni yuborish'}</button>
      <label>Izoh (ixtiyoriy)</label><input id="note" maxlength="300" placeholder="Masalan: domofon 25, qo'ng'iroq qiling"></div>
    <div id="qbox" class="panel"><div class="muted">Hisoblanmoqda…</div></div>
    <button class="btn primary block" id="place" data-a="order" disabled style="min-height:54px;font-size:16px">Buyurtma berish</button>
    <p class="muted small" style="text-align:center">Buyurtma berish orqali siz xizmat shartlariga rozilik bildirasiz.</p></div>`, keep);
  await loadQuote();
}
async function loadQuote() {
  const c = cart();
  const q = await api('POST', '/api/c/quote', { place: c.place, items: c.items.map((i) => ({ product_id: i.product_id, qty: i.qty })) }).catch((e) => ({ error: e.message }));
  const box = $('#qbox'); if (!box) return;
  if (q.error) { box.innerHTML = `<div class="note danger">${esc(q.error)}</div>`; $('#place').disabled = true; return; }
  S.quote = q;
  const pol = q.policy;
  const choices = pol.type === 'cash' ? ['cash', ...q.providers] : q.providers;
  if (!choices.includes(S.pay)) S.pay = choices[0];
  const online = pol.type === 'full' || (S.pay !== 'cash' && (pol.type === 'cash' || S.payOnline));
  const prepay = online ? q.total : pol.prepay_amount;
  box.innerHTML = `<div class="sum"><div class="r"><span>Taomlar</span><span class="num">${som(q.subtotal)}</span></div>
      <div class="r"><span>Yetkazib berish</span><span class="num">${q.delivery_fee ? som(q.delivery_fee) : 'bepul'}</span></div>
      <div class="r b"><span>Jami</span><span class="num">${som(q.total)}</span></div></div>
    ${!q.min_ok ? `<div class="note danger" style="margin-top:10px">Minimal buyurtma: ${som(q.min_order)}. Yana ${som(q.min_order - q.subtotal)} qo'shing.</div>` : ''}
    ${!q.open ? `<div class="note danger" style="margin-top:10px">Joy hozir buyurtma qabul qilmayapti.</div>` : ''}
    <div class="note ${pol.type === 'cash' ? 'ok' : 'warn'}" style="margin-top:12px">${esc(pol.reason)}${pol.type === 'partial' ? `<br><b>${som(pol.prepay_amount)}</b> hozir, <b>${som(pol.cash_amount)}</b> kuryerga naqd.` : ''}</div>
    <h3 style="margin:16px 0 8px">To'lov usuli</h3>
    <div class="opts">${choices.map((k) => `<button class="opt ${S.pay === k ? 'on' : ''}" data-a="pay" data-v="${k}"><i></i>${esc(PROV[k] || k)}</button>`).join('')}</div>
    ${pol.type === 'partial' ? `<label class="chk"><input type="checkbox" id="payall" ${S.payOnline ? 'checked' : ''}> Hammasini onlayn to'layman</label>` : ''}
    ${prepay ? `<div class="muted small" style="margin-top:10px">Hozir to'lanadi: <b>${som(prepay)}</b>${prepay < q.total ? ` · kuryerga: ${som(q.total - prepay)}` : ''}</div>` : `<div class="muted small" style="margin-top:10px">To'lov yetkazilganda kuryerga naqd.</div>`}`;
  $('#payall')?.addEventListener('change', (e) => { S.payOnline = e.target.checked; loadQuote(); });
  $('#place').disabled = !q.min_ok || !q.open;
  $('#place').textContent = prepay ? `To'lash · ${som(prepay)}` : `Buyurtma berish · ${som(q.total)}`;
}

function viewLogin() {
  view(topbar('Kirish', '#') + `<div class="csec"><div class="panel"><h3>Telefon raqamingiz</h3>
    <p class="muted small">Buyurtma holati va kuryer siz bilan shu raqam orqali bog'lanadi.</p>
    <input id="ph" type="tel" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(store.get('dx_phone') || '')}">
    <button class="btn primary block" style="margin-top:12px" data-a="otp">Kod olish</button>
    <div id="step2" hidden><label>SMS kod</label><input id="code" class="otp" inputmode="numeric" maxlength="5" autocomplete="one-time-code">
      <label>Ismingiz</label><input id="nm" maxlength="60" placeholder="Masalan: Javohir">
      <button class="btn primary block" style="margin-top:12px" data-a="login">Kirish</button><div id="dev" class="devcode"></div></div></div></div>`);
}

async function viewPay(id) {
  const o = await run(() => api('GET', '/api/c/orders/' + id));
  if (!o) return go('#orders');
  if (o.status !== 'awaiting_payment') return go('#order/' + id);
  view(topbar("To'lov", '#order/' + id) + `<div class="csec"><div class="bigstat"><div class="ic">💳</div><h2>${som(o.prepay_amount)}</h2><div class="muted">${esc(o.place)} · buyurtma #${o.id}</div></div>
    <div class="note warn">Bu sinov to'lovi sahifasi. Haqiqiy Click/Payme ulanganda mijoz to'lov tizimi sahifasiga yo'naltiriladi.</div>
    <button class="btn primary block" style="margin-top:16px;min-height:54px" data-a="testpay" data-id="${o.id}">To'lash (sinov)</button>
    <button class="btn danger block" style="margin-top:10px" data-a="ocancel" data-id="${o.id}">Buyurtmani bekor qilish</button>
    <p class="muted small" style="text-align:center">To'lanmagan buyurtma 30 daqiqadan keyin avtomatik bekor bo'ladi.</p></div>`);
}

async function viewOrders() {
  if (!S.token) { S.after = '#orders'; return go('#login'); }
  const [me, list] = await Promise.all([api('GET', '/api/c/me').catch(() => null), run(() => api('GET', '/api/c/orders'))]);
  if (!me) { S.after = '#orders'; return go('#login'); }
  S.me = me;
  view(topbar('Buyurtmalarim', '#', `<button class="btn sm" data-a="logout">Chiqish</button>`) + `<div class="csec muted small">${esc(me.name || '')} · ${fmtPhone(me.phone)} · yetkazilgan: ${me.completed}</div>
    ${(list || []).length ? list.map((o) => `<button class="ocard" data-a="go" data-v="#order/${o.id}"><div class="row"><b class="grow">${esc(o.place)}</b><span class="chip ${ST[o.status]?.[2] || ''}">${ST[o.status]?.[1] || ''} ${esc(ST[o.status]?.[0] || o.status)}</span></div>
      <div class="muted small" style="margin-top:6px">#${o.id} · ${dt(o.created_at)} · ${o.items.reduce((t, i) => t + i.qty, 0)} ta taom · <b>${som(o.total)}</b></div></button>`).join('')
      : `<div class="empty"><div class="ic">🧾</div>Hali buyurtma yo'q<br><br><button class="btn primary" data-a="go" data-v="#">Buyurtma berish</button></div>`}`);
}

async function viewOrder(id, silent) {
  const o = await (silent ? api('GET', '/api/c/orders/' + id).catch(() => null) : run(() => api('GET', '/api/c/orders/' + id)));
  if (!o) return silent ? null : go('#orders');
  if (location.hash !== '#order/' + id) return;
  const st = ST[o.status] || [o.status, '•', ''];
  const steps = [['new', "Buyurtma qabul qilindi", o.created_at], ['accepted', 'Restoran tasdiqladi, tayyorlanmoqda', o.accepted_at], ['ready', 'Taom tayyor', o.ready_at], ['on_way', "Kuryer yo'lda", null], ['delivered', 'Yetkazildi', o.delivered_at]];
  const order = ['new', 'accepted', 'ready', 'on_way', 'delivered'];
  const idx = order.indexOf(o.status);
  const eta = o.accepted_at && o.prep_minutes && ['accepted', 'ready', 'on_way'].includes(o.status) ? hhmm(new Date(new Date(o.accepted_at).getTime() + (o.prep_minutes + 20) * 60000).toISOString()) : '';
  const payNote = { paid: ['ok', `Onlayn to'langan: ${som(o.paid_amount)}`], refund_due: ['warn', `To'langan ${som(o.paid_amount)} qaytariladi. Platforma xodimi siz bilan bog'lanadi.`], refunded: ['ok', "To'lov qaytarildi"], pending: ['warn', "To'lov kutilmoqda"] }[o.payment_status];
  const cash = o.total - (o.payment_status === 'paid' ? o.paid_amount : 0);
  view(topbar(`Buyurtma #${o.id}`, '#orders') + `<div class="bigstat"><div class="ic">${st[1]}</div><h2>${esc(st[0])}</h2>
      <div class="muted">${esc(o.place)}${eta ? ` · taxminan ${eta} da` : ''}</div>${o.reject_reason ? `<div class="note danger" style="margin-top:10px">Sabab: ${esc(o.reject_reason)}</div>` : ''}</div>
    <div class="csec">
    ${o.handover_code ? `<div class="panel" style="text-align:center"><div class="muted small">Kuryerga shu kodni ayting — kodsiz buyurtma berilmaydi</div><div class="hcode">${esc(o.handover_code)}</div></div>` : ''}
    ${courierBox(o)}
    ${o.can_rate ? `<div class="panel" style="text-align:center"><h3>Kuryerni baholang</h3><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-a="star" data-v="${n}" class="${S.stars >= n ? 'on' : ''}">★</button>`).join('')}</div>
      <input id="rcm" maxlength="300" placeholder="Izoh (ixtiyoriy)" style="margin-top:10px"><button class="btn primary block" style="margin-top:10px" data-a="rate" data-id="${o.id}">Yuborish</button></div>` : ''}
    ${o.status === 'awaiting_payment' ? `<button class="btn primary block" style="margin-bottom:12px" data-a="go" data-v="#pay/${o.id}">To'lovni yakunlash · ${som(o.prepay_amount)}</button>` : ''}
    ${idx >= 0 ? `<div class="panel"><ul class="tl">${steps.map(([k, n, t], i) => `<li class="${i < idx ? 'done' : i === idx ? 'cur done' : ''}">${n}${t && i <= idx ? ` <span class="muted small">${hhmm(t)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    <div class="panel"><h3>Tarkibi</h3>${o.items.map((i) => `<div class="line"><span class="grow">${esc(i.name)} × ${i.qty}</span><b class="num">${money((i.price + (i.mod_price || 0)) * i.qty)}</b></div>`).join('')}
      <div class="sum" style="margin-top:8px"><div class="r"><span>Yetkazib berish</span><span>${o.delivery_fee ? som(o.delivery_fee) : 'bepul'}</span></div><div class="r b"><span>Jami</span><span>${som(o.total)}</span></div></div>
      ${payNote ? `<div class="note ${payNote[0]}" style="margin-top:10px">${esc(payNote[1])}</div>` : ''}
      ${cash > 0 && !['cancelled', 'rejected', 'no_show', 'delivered'].includes(o.status) ? `<div class="muted small" style="margin-top:8px">Kuryerga naqd: <b>${som(cash)}</b></div>` : ''}</div>
    <div class="panel"><div class="muted small">📍 ${esc(o.address)}${o.note ? `<br>💬 ${esc(o.note)}` : ''}</div></div>
    ${['awaiting_payment', 'new'].includes(o.status) ? `<button class="btn danger block" data-a="ocancel" data-id="${o.id}">Buyurtmani bekor qilish</button>` : ''}</div>`, silent);
  return o;
}

function courierBox(o) {
  const c = o.courier;
  if (!c || !['accepted', 'ready', 'on_way'].includes(o.status)) return '';
  if (c.status === 'searching') return `<div class="note" style="margin-bottom:12px">🔎 Kuryer qidirilmoqda…</div>`;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const d = c.lat != null && o.lat != null ? 2 * R * Math.asin(Math.sqrt(Math.sin(rad(o.lat - c.lat) / 2) ** 2 + Math.cos(rad(c.lat)) * Math.cos(rad(o.lat)) * Math.sin(rad(o.lng - c.lng) / 2) ** 2)) : null;
  const CS = { assigned: 'restoranga ketmoqda', at_restaurant: 'restoranda', picked: 'sizga kelmoqda', at_customer: 'eshigingiz oldida' };
  return `<div class="panel"><div class="row"><div class="logo-sm">🛵</div><div class="grow"><b>${esc(c.name)}</b> <span class="muted small">⭐ ${c.rating ?? '—'}</span>
    <div class="muted small">${esc(c.vehicle || '')} ${esc(c.vehicle_no || '')} · ${CS[c.status] || ''}${d != null ? ` · ${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'}` : ''}</div></div>
    <a class="btn sm" href="tel:+${esc(c.phone)}">📞</a></div>${c.lat != null ? `<a class="small" target="_blank" rel="noopener" href="https://yandex.uz/maps/?pt=${c.lng},${c.lat}&z=16&l=map">Kuryer xaritada</a>` : ''}</div>`;
}

// ---------- Marshrut ----------
function route() {
  clearInterval(S.poll); S.poll = null;
  const h = location.hash || '#';
  let m;
  if ((m = /^#p\/(\w+)$/.exec(h))) return viewPlace(m[1]);
  if (h === '#cart') return viewCart();
  if (h === '#login') return viewLogin();
  if (h === '#orders') return viewOrders();
  if ((m = /^#pay\/(\d+)$/.exec(h))) return viewPay(m[1]);
  if ((m = /^#order\/(\d+)$/.exec(h))) {
    if (!S.token) { S.after = h; return go('#login'); }
    viewOrder(m[1]);
    const id = m[1];
    S.poll = setInterval(async () => { if (document.hidden || location.hash !== '#order/' + id || document.activeElement?.tagName === 'INPUT') return; await viewOrder(id, true); }, 5000);
    return;
  }
  return viewHome();
}

// ---------- Harakatlar ----------
const A = {
  go: (el) => go(el.dataset.v),
  back: (el) => go(el.dataset.v),
  type: (el) => { S.type = el.dataset.v; viewHome(); },
  cat: (el) => { S.cat = Number(el.dataset.v) || null; renderPlace(); },
  qty: async (el) => {
    const m = S.menu, p = m.place, x = m.products.find((y) => y.id === Number(el.dataset.id)); if (!x) return;
    let c = cart();
    if (c.place && c.place !== p.code && c.items.length) {
      if (!confirm(`Savatda "${c.place_name}" taomlari bor. Savatni tozalab, "${p.name}" dan buyurtma qilamizmi?`)) return;
      c = { place: null, items: [] };
    }
    c.place = p.code; c.place_name = p.name;
    const it = c.items.find((i) => i.product_id === x.id);
    if (it) it.qty += Number(el.dataset.d); else c.items.push({ product_id: x.id, name: x.name, price: x.price, qty: 1 });
    c.items = c.items.filter((i) => i.qty > 0);
    saveCart(c); renderPlace(true);
  },
  cqty: (el) => {
    const c = cart(); const it = c.items.find((i) => i.product_id === Number(el.dataset.id)); if (!it) return;
    it.qty = Math.min(50, it.qty + Number(el.dataset.d)); c.items = c.items.filter((i) => i.qty > 0); saveCart(c);
    const a = $('#addr')?.value, n = $('#note')?.value;
    viewCart(true).then(() => { if ($('#addr') && a != null) $('#addr').value = a; if ($('#note') && n) $('#note').value = n; });
  },
  pay: (el) => { S.pay = el.dataset.v; loadQuote(); },
  geo: (el) => {
    if (!navigator.geolocation) return toast("Telefoningiz joylashuvni bermayapti", true);
    el.textContent = '📍 Aniqlanmoqda…';
    navigator.geolocation.getCurrentPosition((pos) => {
      S.geo = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), acc: Math.round(pos.coords.accuracy) };
      store.set('dx_geo', S.geo); el.textContent = `📍 Joylashuv olindi (±${S.geo.acc} m)`; toast('Joylashuv saqlandi');
    }, () => { el.textContent = '📍 Joylashuvimni yuborish'; toast("Joylashuvga ruxsat berilmadi. Manzilni yozib qoldiring", true); }, { enableHighAccuracy: true, timeout: 10000 });
  },
  order: async (el) => {
    const c = cart(), q = S.quote; if (!q) return;
    const address = $('#addr').value.trim();
    if (address.length < 5) { $('#addr').focus(); return toast("Manzilni to'liq yozing", true); }
    store.set('dx_addr', address);
    if (!S.token) { S.after = '#cart'; return go('#login'); }
    const online = q.policy.type !== 'cash' ? S.pay : S.pay !== 'cash' ? S.pay : null;
    const body = { place: c.place, items: c.items.map((i) => ({ product_id: i.product_id, qty: i.qty })), address, note: $('#note').value.trim(),
      ...(S.geo ? { lat: S.geo.lat, lng: S.geo.lng } : {}), ...(online ? { provider: online } : {}), pay_online: q.policy.type === 'cash' ? !!online : (q.policy.type === 'partial' && S.payOnline) };
    el.disabled = true;
    const r = await run(() => api('POST', '/api/c/orders', body));
    el.disabled = false;
    if (!r) return loadQuote();
    saveCart({ items: [] }); S.payOnline = false;
    if (!r.pay_url) { toast('Buyurtma yuborildi!'); return go('#order/' + r.order.id); }
    if (r.pay_url.startsWith('/app/#')) return go(r.pay_url.slice(5));
    location.href = r.pay_url;
  },
  otp: async (el) => {
    const phone = $('#ph').value;
    el.disabled = true;
    const r = await run(() => api('POST', '/api/c/otp', { phone }));
    setTimeout(() => { el.disabled = false; }, 60000);
    if (!r) { el.disabled = false; return; }
    store.set('dx_phone', phone);
    $('#step2').hidden = false; el.textContent = 'Kodni qayta olish (1 daqiqadan keyin)';
    if (r.dev_code) $('#dev').textContent = `Sinov rejimi: SMS o'rniga kod — ${r.dev_code}`;
    $('#code').focus();
  },
  login: async () => {
    const r = await run(() => api('POST', '/api/c/login', { phone: $('#ph').value, code: $('#code').value, name: $('#nm').value.trim() }));
    if (!r) return;
    S.token = r.token; store.set('dx_ctoken', r.token); S.me = r.user;
    toast('Xush kelibsiz!'); const a = S.after; S.after = '#orders'; go(a);
  },
  logout: async () => { await api('POST', '/api/c/logout').catch(() => {}); S.token = null; S.me = null; store.set('dx_ctoken', null); go('#'); },
  testpay: async (el) => { const r = await run(() => api('POST', `/api/c/orders/${el.dataset.id}/test-pay`)); if (r) { toast("To'lov qabul qilindi"); go('#order/' + r.id); } },
  star: (el) => { S.stars = Number(el.dataset.v); document.querySelectorAll('[data-a="star"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= S.stars)); },
  rate: async (el) => {
    if (!S.stars) return toast('Yulduzchani tanlang', true);
    if (await run(() => api('POST', `/api/c/orders/${el.dataset.id}/rate`, { stars: S.stars, comment: $('#rcm').value }))) { toast('Rahmat!'); S.stars = 0; route(); }
  },
  ocancel: async (el) => {
    if (!confirm('Buyurtmani bekor qilamizmi?')) return;
    const r = await run(() => api('POST', `/api/c/orders/${el.dataset.id}/cancel`));
    if (r) { toast('Buyurtma bekor qilindi'); go('#order/' + r.id); }
  },
};
document.addEventListener('click', (e) => { const el = e.target.closest('[data-a]'); if (el && A[el.dataset.a]) { e.preventDefault(); A[el.dataset.a](el, e); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'code') A.login(); if (e.key === 'Enter' && e.target.id === 'ph') A.otp($('[data-a="otp"]')); });
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
