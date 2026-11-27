// FastHub Uz — mijoz ilovasi ekranlari (FastHub prototipi dizayni). Holat, API va harakatlar — client.js. Ikonkalar — /lucide.js (ic).
'use strict';

// Joy turlari: kalit, nom, Lucide ikonka, plitka foni, ikonka rangi. Kalitlar server PLACE_TYPES bilan bir xil (src/modules/delivery.ts).
const TYPES = [
  ['restoran', 'Restoranlar', 'utensils-crossed', '#FFF1EA', '#C2410C'], ['milliy', 'Milliy taomlar', 'soup', '#FFF4E5', '#C2410C'],
  ['fastfood', 'Fast food', 'hamburger', '#FEF6E0', '#B45309'], ['pizza', 'Pitsa', 'pizza', '#FDECEE', '#BE123C'],
  ['sushi', 'Sushi', 'utensils-crossed', '#E9EEFF', '#3346E8'], ['kafe', 'Kafe', 'coffee', '#F4EEE8', '#7C4A21'],
  ['choyxona', 'Choyxona', 'armchair', '#E6F6F8', '#0E7490'], ['shirinlik', 'Shirinlik', 'ice-cream-cone', '#FFEDF3', '#BE185D'],
  ['nonvoyxona', 'Non va pishiriq', 'croissant', '#FEF6E0', '#B45309'], ['dorixona', 'Dorixona', 'pill', '#E8F7EE', '#15803D'],
  ['dokon', "Do'konlar", 'shopping-basket', '#F3ECFF', '#7C3AED']];
const TYPE = Object.fromEntries(TYPES.map(([k, n, i, bg, fg]) => [k, { n, i, bg, fg }]));
const tp = (t) => TYPE[t] || TYPE.restoran;
// Fotosi bor turlar (public/app/img/places/<tur>.jpg); boshqalar restoran fotosini oladi
const PHOTOS = new Set(['restoran', 'milliy', 'fastfood', 'pizza', 'sushi', 'kafe', 'choyxona', 'shirinlik', 'nonvoyxona', 'dokon']);
const coverUrl = (t) => `/app/img/places/${PHOTOS.has(t) ? t : 'restoran'}.jpg`;
const bgImg = (url) => (url ? `background-image:url('${esc(url)}')` : '');
const ST = {
  awaiting_payment: ["To'lov kutilmoqda", 'warn'], new: ['Tasdiqlanmoqda', 'acc'], accepted: ['Tayyorlanmoqda', 'acc'], ready: ['Tayyor', 'acc'],
  on_way: ["Yo'lda", 'acc'], delivered: ['Yetkazildi', 'ok'], cancelled: ['Bekor qilindi', 'bad'], rejected: ['Rad etildi', 'bad'], no_show: ['Olinmadi', 'bad'],
};
const ACTIVE = ['awaiting_payment', 'new', 'accepted', 'ready', 'on_way'];
const PROV = { test: ["Sinov to'lovi", '#8E8E93', 'T'], click: ['Click', '#0063F7', 'C'], payme: ['Payme', '#00B2B2', 'P'], cash: ['Naqd — kuryerga', '#22C55E', ''] };
const payLogo = (k) => { const p = PROV[k] || [k, '#8E8E93', '?']; return `<span style="width:32px;height:32px;border-radius:9px;background:${p[1]};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;flex:0 0 auto">${p[2] || ic('banknote', 18)}</span>`; };
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const mins = (p) => `${p.prep_minutes}–${p.prep_minutes + 20}`;

// ---------- Umumiy qismlar ----------
const TABS = [['#', 'house', 'Asosiy'], ['#orders', 'receipt-text', 'Buyurtmalar'], ['#cart', 'shopping-cart', 'Savat'], ['#me', 'user', 'Profil']];
function tabbar(cur) {
  const n = cartCount(), act = S.activeCount || 0;
  return `<nav class="tabbar glass" data-cur="${cur}">${TABS.map(([h, i, l]) => `<button class="${cur === h ? 'on' : ''}" data-a="go" data-v="${h}">${ic(i, 25, { w: cur === h ? 2.3 : 1.9 })}${l}
    ${h === '#cart' && n ? `<span class="badge">${n}</span>` : ''}${h === '#orders' && act ? `<span class="badge">${act}</span>` : ''}</button>`).join('')}</nav>`;
}
/** Sahifa: tab — pastki panel bilan (asosiy bo'limlar), aks holda orqaga tugmali "push" ekran */
function page(html, { tab = null, keep = false, extra = '' } = {}) {
  const y = window.scrollY;
  $('#app').innerHTML = `<div class="scr ${tab ? '' : 'push notab'} ${extra.includes('bottombar') ? 'withbar' : ''}">${html}</div>${extra}${tab ? tabbar(tab) : ''}`;
  window.scrollTo(0, keep ? y : 0);
}
const backBtn = (h) => `<button class="circle press" data-a="back" data-v="${h}" aria-label="Orqaga">${ic('chevron-left', 22, { w: 2.4 })}</button>`;
const head = (back, title, right = '<span style="width:44px"></span>') => `<div class="pad row sb" style="margin-bottom:12px">${backBtn(back)}<b style="font-size:17px">${title || ''}</b>${right}</div>`;
const emptyBox = (icon, title, text, btn = '') => `<div class="card empty"><span class="big">${ic(icon, 36, { w: 1.7 })}</span><b>${title}</b><span class="mut">${text}</span>${btn}</div>`;
const loading = () => `<div class="empty"><span class="spin"></span></div>`;

// ---------- Bosh sahifa ----------
function homeShell() {
  const addr = store.get('dx_addr') || '';
  page(`<div class="pad row sb">
      <button class="addr press" data-a="go" data-v="#cart"><span>Yetkazish manzili</span><b>${ic('map-pin', 17, { c: 'var(--acc)' })}${esc(addr ? addr.slice(0, 32) : 'Manzilni kiriting')}${ic('chevron-down', 16, { w: 2.6 })}</b></button>
      <div class="row" style="gap:10px"><button class="circle press" data-a="go" data-v="#orders" aria-label="Buyurtmalar">${ic('receipt-text', 21)}</button>
        <button class="circle press" data-a="go" data-v="#me" aria-label="Profil">${ic('user', 21)}</button></div></div>
    <div class="pad" style="margin-top:14px"><label class="field">${ic('search', 20, { c: 'var(--mut)' })}<input id="q" type="search" placeholder="Restoran, taom yoki dorixona" value="${esc(S.q)}" autocomplete="off">
      ${S.q ? `<button data-a="qclear" aria-label="Tozalash">${ic('x', 18, { c: 'var(--mut)' })}</button>` : ''}</label></div>
    <div id="home">${loading()}</div>`, { tab: '#' });
}
const placeRow = (p) => `<button class="card prow press ${p.open ? '' : 'closed'}" data-a="go" data-v="#p/${esc(p.code)}">
  <span class="ph" style="${bgImg(coverUrl(p.type))}"></span>
  <span class="col grow" style="gap:3px"><b>${esc(p.name)}</b><span class="mut sm">${esc(tp(p.type).n)}${p.description ? ' · ' + esc(p.description.slice(0, 40)) : ''}</span>
    <span class="meta"><span>${ic('clock', 13)}${mins(p)} daq</span><span>${ic('bike', 13)}${p.delivery_fee ? money(p.delivery_fee) : 'Bepul'}</span>${p.open ? '' : '<span class="pill bad">Yopiq</span>'}</span></span></button>`;
function renderHome() {
  const box = $('#home'); if (!box) return;
  const all = S.places || [], q = S.q.trim().toLowerCase();
  if (q || S.type) {
    const shown = all.filter((p) => (!S.type || p.type === S.type) && (!q || [p.name, p.description, tp(p.type).n].some((x) => String(x || '').toLowerCase().includes(q))));
    box.innerHTML = `<div class="sect row"><h2 class="h2">${S.type ? esc(tp(S.type).n) : 'Natijalar'}</h2>${S.type ? `<button class="link" data-a="type" data-v="">Hammasi</button>` : ''}</div>
      <div class="pad col stagger" style="gap:10px"><span class="mut sm">${shown.length} ta joy</span>${shown.map(placeRow).join('')
        || emptyBox('search', 'Hech narsa topilmadi', "Boshqa so'z bilan qidirib ko'ring")}</div>`;
    return;
  }
  const count = (k) => all.filter((p) => p.type === k).length;
  const tiles = TYPES.filter(([k]) => count(k)); // joyi bor turlar oldin, 8 taga to'ldirish uchun qolganlari "tez kunda"
  const fill = TYPES.filter(([k]) => !count(k)).slice(0, Math.max(0, 8 - tiles.length));
  const act = (S.orders || []).find((o) => ACTIVE.includes(o.status));
  const open = all.filter((p) => p.open);
  const banners = [
    ...(S.deals?.length ? [['dokon', 'Kechki chegirma', `Ortgan taomlar\n−${Math.max(...S.deals.map((d) => d.percent))}% gacha`, 'deals']] : []),
    ...(count('dorixona') ? [['dokon', 'Dorixonalar', 'Retseptsiz dorilar\neshigingizgacha', 'dorixona']] : []),
    ['milliy', 'FastHub Uz', 'Kuryerni kuzating,\n4 xonali kod bilan oling', ''], ['kafe', 'Kafe va shirinliklar', 'Kofe va desertlar\nyetkazib beriladi', count('kafe') ? 'kafe' : '']];
  box.innerHTML = `${act ? `<button class="card ocard press live" style="margin:16px 16px 0;width:calc(100% - 32px)" data-a="go" data-v="#order/${act.id}">
      <span class="ic-b">${ic(act.status === 'on_way' ? 'bike' : 'flame', 22)}</span><span class="col grow"><b>${ST[act.status][0]}</b><span class="mut sm">${esc(act.place)} · #${act.id}</span></span>${ic('chevron-right', 18, { c: '#C7C7CC' })}</button>` : ''}
    <div class="card svc stagger">${[...tiles, ...fill].map(([k, n, i, bg, fg]) => `<button class="press ${count(k) ? '' : 'soon'}" data-a="${count(k) ? 'type' : 'soon'}" data-v="${k}">
      <i style="background:${bg}">${ic(i, 27, { c: fg, w: 1.9 })}</i><span>${n}</span></button>`).join('')}</div>
    <div class="chips banners">${banners.map(([ph, s, t, to]) => `<button class="banner press" style="${bgImg(coverUrl(ph))}" ${to === 'deals' ? 'data-a="scroll" data-v="deals"' : to ? `data-a="type" data-v="${to}"` : ''}>
      <span class="t"><span>${esc(s)}</span><b>${esc(t)}</b></span></button>`).join('')}</div>
    ${S.deals?.length ? `<div class="sect" id="deals"><h2 class="h2">🌙 Kechki chegirmalar</h2></div><div class="chips near">${S.deals.slice(0, 12).map((d) => `<button class="card deal press" data-a="go" data-v="#p/${esc(d.place_code)}">
      <span class="ph" style="${d.product?.image ? bgImg(DX.asset(d.product.image)) : `background:${tp('restoran').bg}`}">${d.product?.image ? '' : ic('utensils-crossed', 30, { c: tp('restoran').fg })}<span class="off">−${d.percent}%</span></span>
      <b class="sm">${esc(d.product?.name || '')}</b><span class="mut xs">${esc(d.place)} · ${d.left} ta qoldi</span><span><s>${money(d.old_price)}</s> <b>${som(d.price)}</b></span></button>`).join('')}</div>` : ''}
    ${open.length ? `<div class="sect"><h2 class="h2">Hozir ochiq</h2></div><div class="chips near">${open.slice(0, 8).map((p) => `<button class="card ncard press" data-a="go" data-v="#p/${esc(p.code)}">
      <span class="ph" style="${bgImg(coverUrl(p.type))}"><span class="pill w">${ic('clock', 13)}${mins(p)} daq</span></span>
      <span class="bd"><b>${esc(p.name)}</b><span class="mut sm">${esc(tp(p.type).n)} · ${p.delivery_fee ? money(p.delivery_fee) : 'Bepul yetkazish'}</span></span></button>`).join('')}</div>` : ''}
    <div class="sect"><h2 class="h2">Barcha joylar</h2></div>
    <div class="pad col stagger" style="gap:10px">${all.map(placeRow).join('') || emptyBox('store', "Hozircha joylar yo'q", "Tez orada restoran va do'konlar qo'shiladi")}</div>`;
}

// ---------- Joy sahifasi ----------
function renderPlace(keep) {
  const m = S.menu, p = m.place, c = cart(), t = tp(p.type);
  const lineOf = (id, deal = '') => (c.place === p.code ? c.items.find((i) => keyOf(i) === `${id}:${deal}`) : null);
  const pic = (x) => `<span class="ph" style="${x.image ? bgImg(DX.asset(x.image)) : `background:${t.bg}`}">${x.image ? '' : ic(t.i, 34, { c: t.fg, w: 1.6 })}</span>`;
  const ctl = (x) => {
    if (x.in_stop || !p.open) return '';
    const l = lineOf(x.id);
    if (!l) return `<button class="add press" data-a="qty" data-id="${x.id}" data-d="1" aria-label="Qo'shish">${ic('plus', 22, { w: 2.6 })}</button>`;
    return `<span class="qpill ${x.sold_by === 'kg' ? 'kg' : ''}"><button data-a="qty" data-id="${x.id}" data-d="-1" aria-label="Kamaytirish">${ic('minus', 18, { w: 2.6 })}</button>
      <b>${x.sold_by === 'kg' ? kgTxt(l.weight_g) : l.qty}</b><button data-a="qty" data-id="${x.id}" data-d="1" aria-label="Ko'paytirish">${ic('plus', 18, { w: 2.6 })}</button></span>`;
  };
  const item = (x) => `<div class="mi ${x.in_stop ? 'stop' : ''}"><div class="t"><b>${esc(x.name)}</b>
      ${x.sold_by === 'kg' ? `<span class="mut sm">Og'irlik bo'yicha · qadam ${kgTxt(x.step_g || 100)}</span>` : ''}
      <span class="pr">${x.in_stop ? 'Vaqtincha tugagan' : som(x.price) + (x.sold_by === 'kg' ? ' / kg' : '')}</span></div>
    <div class="pic">${pic(x)}${ctl(x)}</div></div>`;
  const cats = m.categories;
  const n = c.place === p.code ? cartCount(c) : 0;
  const y = window.scrollY;
  $('#app').innerHTML = `<div class="place">
    <div class="ptop ${keep && y > 200 ? 'solid' : ''}" id="ptop">${backBtn('#')}<span class="ttl">${esc(p.name)}</span><span style="width:44px"></span></div>
    <div class="hero"><span class="ph" style="${bgImg(coverUrl(p.type))}"></span></div>
    <div class="pinfo"><h1 class="h1" style="font-size:28px">${esc(p.name)}</h1>
      <span class="mut row" style="gap:5px;font-size:14px;margin-top:4px">${ic(t.i, 15)}${esc(t.n)}${p.address ? ' · ' + esc(p.address) : ''}</span>
      ${p.description ? `<p class="mut sm" style="margin:8px 0 0">${esc(p.description)}</p>` : ''}
      <div class="tiles"><span><small>${ic('clock', 13)}Yetkazish</small><b>${mins(p)} daq</b></span><span><small>${ic('bike', 13)}Narxi</small><b>${p.delivery_fee ? som(p.delivery_fee) : 'Bepul'}</b></span>
        <span><small>${ic('shopping-bag', 13)}Minimal</small><b>${p.min_order ? som(p.min_order) : "Yo'q"}</b></span></div>
      ${p.open ? '' : `<div class="note bad" style="margin-top:12px">${ic('clock', 18)}Hozir buyurtma qabul qilmayapti</div>`}
      ${p.type === 'dorixona' ? `<div class="note ok" style="margin-top:12px">${ic('pill', 18)}<span>Faqat retseptsiz dori vositalari. Qo'llashdan oldin yo'riqnomani o'qing va shifokor bilan maslahatlashing.</span></div>` : ''}</div>
    ${(m.deals || []).length && p.open ? `<div class="sect"><h2 class="h2" style="font-size:19px">🌙 Kechki chegirma</h2></div><div class="chips near">${m.deals.map((d) => { const l = lineOf(d.product_id, d.id); return `<div class="card deal" style="background:var(--bg)">
      <span class="ph" style="${d.product?.image ? bgImg(DX.asset(d.product.image)) : `background:${t.bg}`}">${d.product?.image ? '' : ic(t.i, 30, { c: t.fg })}<span class="off">−${d.percent}%</span></span>
      <b class="sm">${esc(d.product?.name || '')}</b><span class="mut xs">${d.left} ta qoldi · ${hhmm(d.ends_at)} gacha</span><span><s>${money(d.old_price)}</s> <b>${som(d.price)}</b></span>
      ${l ? `<div class="stepper" style="background:#fff"><button data-a="qty" data-id="${d.product_id}" data-deal="${d.id}" data-d="-1">${ic('minus', 16)}</button><b>${l.qty}</b><button data-a="qty" data-id="${d.product_id}" data-deal="${d.id}" data-d="1">${ic('plus', 16)}</button></div>`
        : `<button class="btn sm" data-a="qty" data-id="${d.product_id}" data-deal="${d.id}" data-d="1">${ic('plus', 16)} Savatga</button>`}</div>`; }).join('')}</div>` : ''}
    ${cats.length > 1 ? `<div class="chips secs glass">${cats.map((x, i) => `<button class="chip press ${i === 0 ? 'on' : ''}" data-a="sec" data-v="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="menu">${cats.map((ct) => `<div id="sec-${ct.id}" data-sec="${ct.id}"><h2 class="h2">${esc(ct.name)}</h2>${m.products.filter((x) => x.category_id === ct.id).map(item).join('')}</div>`).join('')
      || emptyBox('clipboard-list', "Menyu hali to'ldirilmagan", "Joy menyuni qo'shgach shu yerda ko'rinadi")}</div></div>
    ${n ? `<div class="bottombar glass"><button class="btn press sb" data-a="go" data-v="#cart"><span class="n">${n}</span><span>Savatni ko'rish</span><span>${som(cartSum(c))}</span></button></div>` : ''}`;
  if (keep) window.scrollTo(0, y);
}

// ---------- Savat ----------
function cartShell(c) {
  const addr = store.get('dx_addr') || '';
  const radios = (a, cur, opts) => `<div class="card list">${opts.map(([k, n]) => `<button class="li press ${cur === k ? 'on' : ''}" data-a="${a}" data-v="${k}"><b class="grow" style="font-weight:600">${n}</b><span class="radio"></span></button>`).join('')}</div>`;
  page(`<div class="pad row sb"><span></span><button class="link" style="padding:10px 4px" data-a="cclear">Tozalash</button></div>
    <div class="pad"><h1 class="h1">Savat</h1><button class="mut press" style="font-size:14px;margin-top:2px" data-a="go" data-v="#p/${esc(c.place)}">${esc(c.place_name)} ${ic('chevron-right', 14)}</button></div>
    <div class="card list stagger" style="margin:14px 16px 0">${c.items.map((i) => `<div class="li">
      <span class="ph" style="width:56px;height:56px;border-radius:14px;flex:0 0 auto;${i.image ? bgImg(DX.asset(i.image)) : `background:${tp(c.place_type).bg}`}">${i.image ? '' : ic(tp(c.place_type).i, 24, { c: tp(c.place_type).fg })}</span>
      <span class="t"><b>${esc(i.name)}</b><span>${som(lineSum(i))}${i.weight_g ? ` · ${som(i.price)}/kg` : ''}</span></span>
      <div class="stepper"><button data-a="cqty" data-k="${keyOf(i)}" data-d="-1">${ic('minus', 16)}</button><b style="${i.weight_g ? 'font-size:12px;min-width:52px' : ''}">${i.weight_g ? kgTxt(i.weight_g) : i.qty}</b><button data-a="cqty" data-k="${keyOf(i)}" data-d="1">${ic('plus', 16)}</button></div></div>`).join('')}</div>
    ${c.items.some((i) => i.weight_g) ? `<p class="mut sm pad" style="margin:10px 4px">Og'irlik taxminiy — do'kon tortib, aniq summani tasdiqlaydi. Ortiqcha to'lov qaytariladi.</p>` : ''}
    ${c.pickup ? `<div class="label">Qanday olasiz</div><div class="pad">${radios('mode', S.mode || 'delivery', [['delivery', 'Yetkazib berish'], ['pickup', "O'zim olib ketaman"]])}</div>` : ''}
    ${['dokon', 'dorixona'].includes(c.place_type) ? `<div class="label">Mahsulot bo'lmasa</div><div class="pad">${radios('subst', S.subst || 'call', [['replace', "O'xshashiga almashtiring"], ['remove', 'Olib tashlang (pul qaytariladi)'], ['call', "Qo'ng'iroq qiling"]])}</div>` : ''}
    <div ${S.mode === 'pickup' && c.pickup ? 'hidden' : ''}><div class="label">Yetkazish manzili</div>
      <div class="card" style="margin:0 16px;padding:14px"><textarea id="addr" class="inp" rows="2" placeholder="Shahar, ko'cha, uy, xonadon, mo'ljal">${esc(addr)}</textarea>
        <button class="row press" style="margin-top:10px;color:var(--acc);font-weight:600;gap:8px" data-a="geo">${ic('locate-fixed', 18)}<span>${S.geo ? `Joylashuv olindi (±${S.geo.acc || '?'} m) — yangilash` : 'Joylashuvimni yuborish'}</span></button>
        <input id="note" class="inp" style="margin-top:10px" maxlength="300" placeholder="Izoh: domofon, qavat, qo'ng'iroq qiling"></div></div>
    <div id="qbox">${loading()}</div>
    <p class="mut xs" style="text-align:center;margin:12px 24px">Buyurtma berish orqali <a href="${esc(DX.asset('/legal/terms'))}" target="_blank" rel="noopener">foydalanish shartlari</a>ga rozilik bildirasiz.</p>`,
  { tab: '#cart', extra: `<div class="bottombar glass tabs"><div class="tot"><span>Jami</span><span id="tot">${som(cartSum(c))}</span></div><button class="btn press" id="place" data-a="order" disabled>Hisoblanmoqda…</button></div>` });
}
function quoteBox(q, choices, prepay) {
  const pol = q.policy;
  return `<div class="card col" style="margin:14px 16px 0;padding:12px 16px;gap:6px;font-size:15px">
      <div class="row sb"><span class="mut">Mahsulotlar</span><b style="font-weight:600">${som(q.subtotal)}</b></div>
      <div class="row sb"><span class="mut">${q.mode === 'pickup' ? 'Olib ketish' : 'Yetkazish'}</span><b style="font-weight:600">${q.delivery_fee ? som(q.delivery_fee) : 'Bepul'}</b></div>
      ${q.debt ? `<div class="row sb" style="color:var(--warn)"><span>Oldingi olinmagan buyurtma</span><b style="font-weight:600">${som(q.debt)}</b></div>` : ''}</div>
    ${!q.min_ok ? `<div class="note bad" style="margin:10px 16px 0">${ic('info', 18)}<span>Minimal buyurtma ${som(q.min_order)}. Yana ${som(q.min_order - q.subtotal)} qo'shing.</span></div>` : ''}
    ${!q.open ? `<div class="note bad" style="margin:10px 16px 0">${ic('clock', 18)}<span>Joy hozir buyurtma qabul qilmayapti.</span></div>` : ''}
    <div class="label">To'lov usuli</div>
    <div class="card list" style="margin:0 16px">${choices.map((k) => `<button class="li press ${S.pay === k ? 'on' : ''}" data-a="pay" data-v="${k}">${payLogo(k)}<b class="grow" style="font-weight:600;font-size:16px">${esc((PROV[k] || [k])[0])}</b><span class="radio"></span></button>`).join('')}
      ${pol.type === 'partial' ? `<label class="li"><input type="checkbox" id="payall" ${S.payOnline ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--acc)"><b class="grow" style="font-weight:600">Hammasini onlayn to'layman</b></label>` : ''}</div>
    <p class="mut row sm" style="margin:10px 20px;gap:8px;align-items:flex-start">${ic('info', 16)}<span>${esc(pol.reason)}${pol.type === 'partial' ? ` ${som(pol.prepay_amount)} hozir, ${som(pol.cash_amount)} kuryerga naqd.` : ''}
      ${prepay && prepay < q.total ? ` Hozir: ${som(prepay)}, kuryerga: ${som(q.total - prepay)}.` : ''}${!prepay ? ' To\'lov yetkazilganda kuryerga naqd.' : ''}</span></p>`;
}
