// FastHub Uz — mijoz ilovasi: holat, API, savat, marshrut va harakatlar. Ekranlar: views.js (asosiy, joy, savat), orders.js, account.js.
// Build'siz vanilla JS. Ikonkalar: /lucide.js.
'use strict';

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

const S = { token: store.get('dx_ctoken'), me: null, type: '', q: '', places: null, deals: [], orders: null, activeCount: 0, menu: null, quote: null, pay: null,
  payOnline: false, after: '#orders', poll: null, geo: store.get('dx_geo', true) };
const cart = () => store.get('dx_cart', true) || { place: null, place_name: '', items: [] };
const saveCart = (c) => store.set('dx_cart', c.items.length ? c : null);
const cartCount = (c = cart()) => c.items.reduce((t, i) => t + (i.weight_g ? 1 : i.qty), 0);
const lineSum = (i) => (i.weight_g ? Math.round((i.price * i.weight_g) / 1000) : i.price * i.qty); // kg mahsulot: narx 1 kg uchun
const cartSum = (c = cart()) => c.items.reduce((t, i) => t + lineSum(i), 0);
const keyOf = (i) => `${i.product_id}:${i.deal_id || ''}`;
const kgTxt = (g) => `${+(g / 1000).toFixed(3)} kg`;
const itemsPayload = (c) => c.items.map((i) => (i.weight_g ? { product_id: i.product_id, weight_g: i.weight_g } : { product_id: i.product_id, qty: i.qty, ...(i.deal_id ? { deal_id: i.deal_id } : {}) }));
const setOrders = (list) => {
  S.orders = list || []; S.activeCount = S.orders.filter((o) => ACTIVE.includes(o.status)).length;
  const tb = $('.tabbar'); if (tb) tb.outerHTML = tabbar(tb.dataset.cur); // pastki paneldagi belgilar yangilansin
};

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.innerHTML = ic(err ? 'info' : 'circle-check', 20) + `<span>${esc(msg)}</span>`;
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
const go = (h) => { if (location.hash === h || (h === '#' && !location.hash)) route(); else location.hash = h; };

// ---------- Yuklash ----------
async function viewHome() {
  homeShell();
  const [list, deals, orders] = await Promise.all([run(() => api('GET', '/api/c/places')), api('GET', '/api/c/deals').catch(() => []), S.token ? api('GET', '/api/c/orders').catch(() => null) : null]);
  if (!list) return;
  S.places = list; S.deals = deals; locate(false);
  if (orders) setOrders(orders);
  renderHome();
}
async function viewPlace(code) {
  page(`${head('#', '')}${loading()}`);
  const m = await run(() => api('GET', '/api/c/places/' + encodeURIComponent(code)));
  if (!m) return go('#');
  S.menu = m; renderPlace();
}
async function viewCart(keep) {
  const c = cart();
  if (!c.items.length) return page(`<div class="pad"><h1 class="h1" style="margin-bottom:16px">Savat</h1>
    ${emptyBox('shopping-cart', "Savat bo'sh", "Restoran, kafe yoki dorixonadan biror narsa tanlang", `<button class="btn" style="width:220px" data-a="go" data-v="#">Tanlashga o'tish</button>`)}</div>`, { tab: '#cart' });
  const y = window.scrollY;
  cartShell(c);
  if (keep) window.scrollTo(0, y);
  await loadQuote();
}
async function loadQuote() {
  const c = cart();
  const q = await api('POST', '/api/c/quote', { place: c.place, items: itemsPayload(c), mode: c.pickup && S.mode === 'pickup' ? 'pickup' : 'delivery' }).catch((e) => ({ error: e.message }));
  const box = $('#qbox'), btn = $('#place'); if (!box || !btn) return;
  if (q.error) { box.innerHTML = `<div class="note bad" style="margin:14px 16px 0">${ic('info', 18)}<span>${esc(q.error)}</span></div>`; btn.disabled = true; btn.textContent = 'Buyurtma berib bo\'lmaydi'; return; }
  S.quote = q;
  const pol = q.policy;
  const choices = pol.type === 'cash' ? ['cash', ...q.providers] : q.providers;
  if (!choices.includes(S.pay)) S.pay = choices[0];
  const online = pol.type === 'full' || (S.pay !== 'cash' && (pol.type === 'cash' || S.payOnline));
  const prepay = online ? q.total : pol.prepay_amount;
  box.innerHTML = quoteBox(q, choices, prepay);
  $('#payall')?.addEventListener('change', (e) => { S.payOnline = e.target.checked; loadQuote(); });
  $('#tot').textContent = som(q.total);
  btn.disabled = !q.min_ok || !q.open;
  btn.textContent = prepay ? `To'lash · ${som(prepay)}` : `Buyurtma berish · ${som(q.total)}`;
}

// Foydalanuvchi joylashuvi (masofa, "Yaqin atrofda", xarita): ruxsat bo'lsa jim, aks holda faqat tugma bosilganda so'raladi
function locate(ask) {
  if (!navigator.geolocation) return ask && toast('Telefoningiz joylashuvni bermayapti', true);
  const go2 = () => navigator.geolocation.getCurrentPosition((pos) => {
    S.geo = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), acc: Math.round(pos.coords.accuracy) };
    store.set('dx_geo', S.geo); renderHome();
  }, () => ask && toast('Joylashuvga ruxsat berilmadi', true), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  if (ask) return go2();
  navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') go2(); }).catch(() => {});
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
  if (h === '#me') return viewMe();
  if (h === '#map') return S.places ? viewMap() : api('GET', '/api/c/places').then((l) => { S.places = l; viewMap(); }).catch((e) => toast(e.message, true));
  if (h === '#delete') return viewDelete();
  if ((m = /^#pay\/(\d+)$/.exec(h))) return viewPay(m[1]);
  if ((m = /^#claim\/(\d+)$/.exec(h))) { if (!S.token) { S.after = h; return go('#login'); } return viewClaim(m[1]); }
  if ((m = /^#order\/(\d+)$/.exec(h))) {
    if (!S.token) { S.after = h; return go('#login'); }
    const id = m[1];
    viewOrder(id);
    S.poll = setInterval(async () => { if (document.hidden || location.hash !== '#order/' + id || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || S.claimPhoto) return; await viewOrder(id, true); }, 5000);
    return;
  }
  return viewHome();
}

// Rasm: telefonda galereya/kamera → 1200 px JPEG
function pickPhoto() {
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return resolve(null);
      const fr = new FileReader(), im = new Image();
      fr.onload = () => { im.src = fr.result; };
      im.onload = () => {
        const k = Math.min(1, 1200 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        let q = 0.75, d = c.toDataURL('image/jpeg', q); while (d.length > 650000 && q > 0.3) { q -= 0.15; d = c.toDataURL('image/jpeg', q); }
        resolve(d);
      };
      im.onerror = () => { toast("Rasmni o'qib bo'lmadi", true); resolve(null); };
      fr.readAsDataURL(f);
    };
    inp.click();
  });
}
const radioOn = (el) => document.querySelectorAll(`[data-a="${el.dataset.a}"]`).forEach((b) => b.classList.toggle('on', b === el));
const keepCartInputs = () => { const a = $('#addr')?.value, n = $('#note')?.value; return () => { if ($('#addr') && a != null) $('#addr').value = a; if ($('#note') && n) $('#note').value = n; }; };

// ---------- Harakatlar ----------
const A = {
  go: (el) => go(el.dataset.v),
  back: (el) => go(el.dataset.v),
  tologin: (el) => { S.after = el.dataset.v || '#orders'; go('#login'); },
  type: (el) => { S.type = el.dataset.v; S.q = ''; if (location.hash && location.hash !== '#') return go('#'); homeShell(); renderHome(); },
  qclear: () => { S.q = ''; homeShell(); renderHome(); },
  soon: () => toast("Bu toifa tez orada qo'shiladi"),
  mapType: (el) => { S.mapType = el.dataset.v; viewMap(); },
  homeGeo: () => locate(true),
  scroll: (el) => $('#' + el.dataset.v)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  sec: (el) => { const t = $('#sec-' + el.dataset.v); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 130, behavior: 'smooth' }); radioOn(el); },
  qty: async (el) => {
    const m = S.menu, p = m.place, x = m.products.find((y) => y.id === Number(el.dataset.id)); if (!x) return;
    let c = cart();
    if (c.place && c.place !== p.code && c.items.length) {
      if (!confirm(`Savatda "${c.place_name}" mahsulotlari bor. Savatni tozalab, "${p.name}" dan buyurtma qilamizmi?`)) return;
      c = { place: null, items: [] };
    }
    c.place = p.code; c.place_name = p.name; c.place_type = p.type; c.pickup = p.pickup;
    const d = Number(el.dataset.d), deal = el.dataset.deal ? (m.deals || []).find((z) => z.id === Number(el.dataset.deal)) : null;
    const it = c.items.find((i) => keyOf(i) === `${x.id}:${deal ? deal.id : ''}`);
    if (x.sold_by === 'kg' && !deal) {
      const step = x.step_g || 100;
      if (it) it.weight_g += d * step; else if (d > 0) c.items.push({ product_id: x.id, name: x.name, price: x.price, image: x.image || null, qty: 1, weight_g: step, step_g: step });
    } else if (deal) {
      if (it) it.qty = Math.min(deal.left, it.qty + d); else if (d > 0) c.items.push({ product_id: x.id, name: `🌙 ${x.name}`, price: deal.price, image: x.image || null, qty: 1, deal_id: deal.id });
    } else if (it) it.qty += d; else c.items.push({ product_id: x.id, name: x.name, price: x.price, image: x.image || null, qty: 1 });
    c.items = c.items.filter((i) => (i.weight_g != null ? i.weight_g > 0 : i.qty > 0));
    saveCart(c); renderPlace(true);
  },
  cqty: (el) => {
    const c = cart(); const it = c.items.find((i) => keyOf(i) === el.dataset.k); if (!it) return;
    if (it.weight_g) it.weight_g += Number(el.dataset.d) * (it.step_g || 100); else it.qty = Math.min(50, it.qty + Number(el.dataset.d));
    c.items = c.items.filter((i) => (i.weight_g != null ? i.weight_g > 0 : i.qty > 0)); saveCart(c);
    const restore = keepCartInputs(); viewCart(true).then(restore);
  },
  cclear: () => { if (confirm('Savatni tozalaymizmi?')) { saveCart({ items: [] }); viewCart(); } },
  pay: (el) => { S.pay = el.dataset.v; loadQuote(); },
  mode: (el) => { S.mode = el.dataset.v; const restore = keepCartInputs(); viewCart(true).then(restore); },
  subst: (el) => { S.subst = el.dataset.v; radioOn(el); },
  geo: (el) => {
    if (!navigator.geolocation) return toast('Telefoningiz joylashuvni bermayapti', true);
    const t = el.querySelector('span'); t.textContent = 'Aniqlanmoqda…';
    navigator.geolocation.getCurrentPosition((pos) => {
      S.geo = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), acc: Math.round(pos.coords.accuracy) };
      store.set('dx_geo', S.geo); t.textContent = `Joylashuv olindi (±${S.geo.acc} m) — yangilash`; toast('Joylashuv saqlandi');
    }, () => { t.textContent = 'Joylashuvimni yuborish'; toast('Joylashuvga ruxsat berilmadi. Manzilni yozib qoldiring', true); }, { enableHighAccuracy: true, timeout: 10000 });
  },
  order: async (el) => {
    const c = cart(), q = S.quote; if (!q) return;
    const pickup = c.pickup && S.mode === 'pickup';
    const address = pickup ? '' : $('#addr').value.trim();
    if (!pickup && address.length < 5) { $('#addr').focus(); return toast("Manzilni to'liq yozing", true); }
    if (!pickup) store.set('dx_addr', address);
    if (!S.token) { S.after = '#cart'; return go('#login'); }
    const online = q.policy.type !== 'cash' ? S.pay : S.pay !== 'cash' ? S.pay : null;
    const body = { place: c.place, items: itemsPayload(c), address, note: $('#note').value.trim(), mode: pickup ? 'pickup' : 'delivery',
      ...(['dokon', 'dorixona'].includes(c.place_type) ? { substitution: S.subst || 'call' } : {}),
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
    $('#step2').hidden = false; el.textContent = 'Kodni qayta olish (1 daqiqadan keyin)'; el.className = 'btn sec press';
    if (r.dev_code) $('#dev').textContent = `Sinov rejimi: SMS o'rniga kod — ${r.dev_code}`;
    $('#code').focus();
  },
  login: async () => {
    const r = await run(() => api('POST', '/api/c/login', { phone: $('#ph').value, code: $('#code').value, name: $('#nm').value.trim() }));
    if (!r) return;
    S.token = r.token; store.set('dx_ctoken', r.token); S.me = r.user;
    toast('Xush kelibsiz!'); const a = S.after; S.after = '#orders'; go(a);
  },
  logout: async () => { if (!confirm('Akkauntdan chiqamizmi?')) return; await api('POST', '/api/c/logout').catch(() => {}); S.token = null; S.me = null; setOrders([]); store.set('dx_ctoken', null); go('#'); },
  rename: async () => {
    const name = prompt('Ismingiz', S.me?.name || ''); if (name == null || !name.trim()) return;
    if (await run(() => api('POST', '/api/c/me', { name: name.trim() }))) { toast('Saqlandi'); viewMe(); }
  },
  delOtp: async (el) => {
    el.disabled = true;
    const r = await run(() => api('POST', '/api/c/otp', { phone: S.me.phone }));
    setTimeout(() => { el.disabled = false; }, 60000);
    if (!r) { el.disabled = false; return; }
    $('#step2').hidden = false; if (r.dev_code) $('#dev').textContent = `Sinov rejimi: SMS o'rniga kod — ${r.dev_code}`; $('#dcode').focus();
  },
  delConfirm: async () => {
    if (!confirm("Akkaunt butunlay o'chiriladi. Davom etamizmi?")) return;
    const r = await run(() => api('POST', '/api/account/delete', { kind: 'customer', phone: S.me.phone, code: $('#dcode').value }));
    if (!r) return;
    S.token = null; S.me = null; setOrders([]); store.set('dx_ctoken', null); store.set('dx_phone', null);
    toast(r.message); go('#');
  },
  testpay: async (el) => { const r = await run(() => api('POST', `/api/c/orders/${el.dataset.id}/test-pay`)); if (r) { toast("To'lov qabul qilindi"); go('#order/' + r.id); } },
  star: (el) => { S.stars = Number(el.dataset.v); document.querySelectorAll('[data-a="star"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= S.stars)); },
  rate: async (el) => {
    if (!S.stars) return toast('Yulduzchani tanlang', true);
    if (await run(() => api('POST', `/api/c/orders/${el.dataset.id}/rate`, { stars: S.stars, comment: $('#rcm').value }))) { toast('Rahmat!'); S.stars = 0; route(); }
  },
  ccat: (el) => { S.claimCat = el.dataset.v; radioOn(el); },
  cphoto: async () => { const d = await pickPhoto(); if (d) { S.claimPhoto = d; $('#cph').textContent = "✓ Rasm qo'shildi"; } },
  claim: async (el) => {
    if (!S.claimCat) return toast('Muammo turini tanlang', true);
    const text = $('#ctext').value.trim(); if (text.length < 3) { $('#ctext').focus(); return toast('Muammoni yozing', true); }
    el.disabled = true;
    const r = await run(() => api('POST', `/api/c/orders/${el.dataset.id}/claim`, { category: S.claimCat, text, amount: Number($('#camount').value) || 0, ...(S.claimPhoto ? { photo: S.claimPhoto } : {}) }));
    el.disabled = false;
    if (r) { S.claimCat = null; S.claimPhoto = null; toast("Shikoyat yuborildi. Javobni shu yerda ko'rasiz"); go('#order/' + el.dataset.id); }
  },
  claimNote: async (el) => {
    const text = $('#cnote').value.trim(); if (!text && !S.claimPhoto) return toast("Matn yozing yoki rasm qo'shing", true);
    if (await run(() => api('POST', `/api/c/claims/${el.dataset.id}/note`, { text, ...(S.claimPhoto ? { photo: S.claimPhoto } : {}) }))) { S.claimPhoto = null; toast('Yuborildi'); route(); }
  },
  ocancel: async (el) => {
    if (!confirm('Buyurtmani bekor qilamizmi?')) return;
    const r = await run(() => api('POST', `/api/c/orders/${el.dataset.id}/cancel`));
    if (r) { toast('Buyurtma bekor qilindi'); go('#order/' + r.id); }
  },
};
document.addEventListener('click', (e) => { const el = e.target.closest('[data-a]'); if (el && A[el.dataset.a]) { e.preventDefault(); A[el.dataset.a](el, e); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'code') A.login(); if (e.key === 'Enter' && e.target.id === 'ph') A.otp($('[data-a="otp"]')); });
document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; renderHome(); } });
// Joy sahifasi: yuqori panel aylantirganda shaffofdan oq bo'ladi, bo'lim tugmasi joriy bo'limni ko'rsatadi
window.addEventListener('scroll', () => {
  const top = $('#ptop'); if (!top) return;
  top.classList.toggle('solid', window.scrollY > 200);
  const secs = [...document.querySelectorAll('[data-sec]')]; if (!secs.length) return;
  const cur = secs.filter((s) => s.getBoundingClientRect().top < 160).pop() || secs[0];
  document.querySelectorAll('[data-a="sec"]').forEach((b) => b.classList.toggle('on', b.dataset.v === cur.dataset.sec));
}, { passive: true });
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
