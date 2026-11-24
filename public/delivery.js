// Dasturxon POS — 6-etap: Yetkazib berish buyurtmalari (kassa), ilova sozlamalari (Boshqaruv)
'use strict';

S.dlv = []; S.dlvNew = 0;
const DST = { new: ['Yangi', 'info'], accepted: ['Tayyorlanmoqda', 'warn'], ready: ['Tayyor', 'ok'], on_way: ["Yo'lda", 'ok'], delivered: ['Yetkazildi', 'ok'],
  cancelled: ['Mijoz bekor qildi', 'danger'], rejected: ['Rad etildi', 'danger'], no_show: ['Mijoz olmadi', 'danger'], awaiting_payment: ["To'lov kutilmoqda", ''] };
const PLACE_TYPES = [['restoran', 'Restoran'], ['fastfood', 'Fastfud'], ['kafe', 'Kafe'], ['choyxona', 'Choyxona'], ['shirinlik', 'Shirinliklar'], ['dorixona', 'Dorixona'], ['dokon', "Do'kon"]];
const SUBST = { replace: "🔁 Yo'q bo'lsa — o'xshashiga almashtiring", remove: "✖ Yo'q bo'lsa — olib tashlang", call: "📞 Yo'q bo'lsa — qo'ng'iroq qiling" };
const dlvOn = () => S.boot?.business?.delivery && S.boot.business.delivery.status !== 'disabled' && CASHR.includes(S.user?.role);

// Ovozli signal — yangi buyurtma javobsiz qolmasin (planshet ovozi yoqilgan bo'lishi kerak)
let actx;
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((t) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.25, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + t + 0.18);
      o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.2);
    });
  } catch {}
}
document.addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch {} }, { once: true });

async function loadDlv(notify) {
  if (!dlvOn()) return;
  const list = await api('GET', '/api/delivery/orders').catch(() => null);
  if (!list) return;
  const before = new Set(S.dlv.filter((o) => o.status === 'new').map((o) => o.id));
  S.dlv = list; S.dlvNew = list.filter((o) => o.status === 'new').length;
  const fresh = list.filter((o) => o.status === 'new' && !before.has(o.id));
  if (notify && fresh.length) { beep(); fresh.forEach((o) => toast(`🛵 Yangi buyurtma D-${o.id} · ${som(o.total)}`)); }
  const tab = document.querySelector('nav.tabs [data-v="delivery"]');
  if (tab) tab.innerHTML = `🛵 Yetkazish${S.dlvNew ? ` <span class="nbadge">${S.dlvNew}</span>` : ''}`;
}
setInterval(() => { if (S.dlvNew && S.user && dlvOn()) beep(); }, 30000); // qabul qilinmaguncha har 30 soniyada eslatadi

{ const prev = HOOKS.onStart; HOOKS.onStart = async () => { await prev?.(); await loadDlv(false); }; }
{ const prev = HOOKS.onChange; HOOKS.onChange = async (types) => { await prev?.(types); if (types.includes('delivery') || types.includes('orders')) await loadDlv(true); }; }

// ---------- Kassa: yetkazib berish doskasi ----------
const payInfo = (o) => {
  const online = o.payment_status === 'paid' ? o.paid_amount : 0, cash = o.total - online;
  return `${online ? `<span class="chip ok">Onlayn ${money(online)}</span>` : ''}${cash > 0 ? `<span class="chip warn">${o.courier_id ? 'Kuryer oladi' : 'Naqd'} ${money(cash)}</span>` : ''}${o.payment_status === 'refund_due' ? '<span class="chip danger">Pul qaytarilishi kerak</span>' : ''}`;
};
const mapLink = (o) => (o.lat != null && o.lng != null ? ` <a class="small" target="_blank" rel="noopener" href="https://yandex.uz/maps/?pt=${o.lng},${o.lat}&z=17&l=map">xarita</a>` : '');
function dcard(o) {
  const eta = o.accepted_at && o.prep_minutes ? hhmm(new Date(new Date(o.accepted_at).getTime() + o.prep_minutes * 60000).toISOString()) : '';
  const btn = (a, n, cls = '') => `<button class="btn sm ${cls}" data-a="${a}" data-id="${o.id}">${n}</button>`;
  const c = o.courier, hasC = !!o.courier_id, searching = !hasC && !o.own_delivery && c?.status === 'searching';
  const CST = { assigned: 'restoranga kelmoqda', at_restaurant: 'restoranda kutmoqda', picked: "mijozga yo'lda", at_customer: 'mijoz eshigida', delivered: 'topshirdi', no_show: 'mijoz chiqmadi' };
  const cline = hasC && c ? `<div class="cline">🛵 <b>${esc(c.name)}</b> ⭐${c.rating ?? '—'} · ${esc(c.vehicle || '')} ${esc(c.vehicle_no || '')} · <a href="tel:+${esc(c.phone)}">${fmtPhoneD(c.phone)}</a>
      <div class="muted small">${CST[c.status] || ''}${c.loc_at ? ` · GPS ${hhmm(c.loc_at)}` : ''}${c.lat != null ? ` <a target="_blank" rel="noopener" href="https://yandex.uz/maps/?pt=${c.lng},${c.lat}&z=16&l=map">xaritada</a>` : ''}</div></div>`
    : searching ? `<div class="cline searching">🔎 Kuryer qidirilmoqda${c.since ? ` · <span data-since="${c.since}">${ago(c.since)}</span>` : ''}</div>` : o.own_delivery ? '<div class="cline muted small">🚗 O\'zimiz yetkazamiz</div>' : '';
  const pickup = o.mode === 'pickup';
  const adjustBtn = o.status === 'new' ? btn('dAdjust', "✏️ O'zgartirish", 'ghost') : '';
  const actions = pickup ? {
    new: btn('dAccept', 'Qabul qilish', 'primary') + btn('dReject', 'Rad etish', 'danger') + adjustBtn,
    accepted: btn('dReady', 'Tayyor', 'primary') + btn('dReject', 'Rad etish', 'ghost'),
    ready: btn('dDelivered', '🚶 Mijoz oldi', 'primary') + btn('dNoShow', 'Kelmadi', 'danger'),
  }[o.status] || '' : hasC ? {
    accepted: btn('dReady', 'Tayyor', 'primary') + btn('dReject', 'Rad etish', 'ghost'),
    ready: '<span class="muted small">Kuryer plomba rasmini olib, buyurtmani oladi</span>',
    on_way: '<span class="muted small">Kuryer mijozga 4 xonali kod bilan topshiradi</span>',
  }[o.status] || '' : searching ? {
    accepted: btn('dReady', 'Tayyor') + btn('dOwn', "O'zimiz yetkazamiz", 'ghost'),
    ready: btn('dOwn', "O'zimiz yetkazamiz", 'primary'),
  }[o.status] || '' : {
    new: btn('dAccept', 'Qabul qilish', 'primary') + btn('dReject', 'Rad etish', 'danger') + adjustBtn,
    accepted: btn('dReady', 'Tayyor') + btn('dDispatch', 'Kuryerga berildi', 'primary') + btn('dReject', 'Rad etish', 'ghost'),
    ready: btn('dDispatch', 'Kuryerga berildi', 'primary') + btn('dDelivered', 'Yetkazildi'),
    on_way: btn('dDelivered', 'Yetkazildi', 'primary') + btn('dNoShow', 'Mijoz olmadi', 'danger'),
  }[o.status] || '';
  return `<div class="dcard ${o.status}"><div class="row"><b>D-${o.id}</b><span class="muted small num" data-since="${o.created_at}">${ago(o.created_at)}</span><div class="grow"></div>${eta ? `<span class="chip">⏱ ${eta}</span>` : ''}</div>
    <div class="small" style="margin:6px 0">👤 ${esc(o.name || 'Mijoz')} · <a href="tel:+${esc(o.phone)}">${fmtPhoneD(o.phone)}</a></div>
    ${(o.risk || []).length ? `<div style="margin-bottom:4px">${o.risk.map((r) => `<span class="chip warn risk">⚠ ${esc(r)}</span>`).join('')}</div>` : ''}
    <div class="small muted">${pickup ? '🚶 <b>Olib ketadi</b>' : `📍 ${esc(o.address || '')}${mapLink(o)}`}</div>
    ${o.substitution ? `<div class="small" style="margin-top:4px">${SUBST[o.substitution] || ''}</div>` : ''}
    ${o.refund_amount ? `<div class="small" style="margin-top:4px;color:var(--warn)">↩ Mijozga ${money(o.refund_amount)} qaytariladi</div>` : ''}
    ${o.note ? `<div class="small" style="margin-top:4px">💬 ${esc(o.note)}</div>` : ''}
    <div class="ditems">${o.items.map((i) => `<div class="r"><span>${esc(i.name)}${i.comment ? ` <i class="muted">(${esc(i.comment)})</i>` : ''}</span><b>× ${i.qty}</b></div>`).join('')}</div>
    <div class="row wrap" style="gap:6px"><b class="num">${som(o.total - (o.debt_amount || 0))}</b><div class="grow"></div>${payInfo(o)}</div>${cline}
    <div class="row wrap dact">${actions}</div></div>`;
}
const fmtPhoneD = (p) => (p && p.length === 12 ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : esc(p || ''));

async function viewDelivery(main) {
  await loadDlv(false);
  const today = await api('GET', '/api/delivery/orders?scope=today').catch(() => []);
  if (S.view !== 'delivery') return;
  const sub = S.boot.business.delivery;
  const cols = [['new', 'Yangi'], ['accepted', 'Tayyorlanmoqda'], ['ready', 'Tayyor'], ['on_way', "Yo'lda"]];
  const done = today.filter((o) => !['new', 'accepted', 'ready', 'on_way'].includes(o.status));
  const sum = done.filter((o) => o.status === 'delivered').reduce((t, o) => t + o.total, 0);
  const pend = today.filter((o) => o.pos_pending);
  main.innerHTML = `${pend.length ? `<div class="banner warn" style="margin:-16px -16px 14px">Kuryer yetkazgan, lekin chek yopilmagan (smena yopiq edi): ${pend.map((o) => `D-${o.id} <button class="btn sm" data-a="dClosePos" data-id="${o.id}">Chekni yopish</button>`).join(' ')}</div>` : ''}${!S.boot.shift ? '<div class="banner warn" style="margin:-16px -16px 14px">Smena yopiq — buyurtmani qabul qilish uchun Kassa bo\'limida smenani oching.</div>' : ''}
    ${['expired', 'blocked'].includes(sub.status) ? '<div class="banner danger" style="margin:-16px -16px 14px">Yetkazib berish obunasi faol emas — ilovada ko\'rinmaysiz.</div>' : ''}
    <div class="row" style="margin-bottom:12px"><div class="grow"></div><button class="btn sm" data-a="dDeals">🌙 Kechki chegirmalar</button></div>
    <div class="dboard">${cols.map(([k, n]) => { const l = S.dlv.filter((o) => o.status === k); return `<section class="dcol"><h3>${n} <span class="chip ${DST[k][1]}">${l.length}</span></h3>${l.map(dcard).join('') || '<div class="muted small dempty">—</div>'}</section>`; }).join('')}</div>
    <div class="panel" style="margin-top:14px"><div class="row"><h3 style="margin:0">Bugun yakunlanganlar</h3><div class="grow"></div><span class="muted">Yetkazildi: <b>${done.filter((o) => o.status === 'delivered').length}</b> ta · ${som(sum)}</span></div>
      <table class="list" style="margin-top:8px"><tr><th>#</th><th>Vaqt</th><th>Mijoz</th><th>Holat</th><th>To'lov</th><th class="right">Summa</th></tr>
      ${done.map((o) => `<tr><td>D-${o.id}</td><td class="muted">${hhmm(o.created_at)}</td><td>${esc(o.name || '')} <span class="muted small">${fmtPhoneD(o.phone)}</span></td>
        <td><span class="chip ${DST[o.status]?.[1] || ''}">${DST[o.status]?.[0] || o.status}</span>${o.reject_reason ? ` <span class="muted small">${esc(o.reject_reason)}</span>` : ''}</td><td>${payInfo(o)}</td>
        <td class="right num">${money(o.total - (o.debt_amount || 0))}${can('admin', 'menejer') && ['delivered', 'no_show'].includes(o.status) ? ` <button class="btn sm ghost" title="Shikoyat" data-a="dDispute" data-id="${o.id}" data-c="${o.courier_id ? 1 : 0}">⚠️</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Hali yo\'q</td></tr>'}</table></div>
    ${can('admin', 'menejer') ? '<div id="dplat"></div>' : ''}`;
  if (can('admin', 'menejer')) renderPlatBlock();
}
VIEWS.delivery = viewDelivery;

// ---------- 8-etap: platforma bilan hisob-kitob va shikoyatlar (menejer/admin) ----------
const DPARTY = { customer: 'Mijoz', restaurant: 'Restoran', courier: 'Kuryer', platform: 'Platforma', none: 'hech kim' };
async function renderPlatBlock() {
  const [st, ds] = await Promise.all([api('GET', '/api/delivery/settlements').catch(() => null), api('GET', '/api/delivery/disputes').catch(() => [])]);
  const box = $('#dplat'); if (!box || !st) return;
  const u = st.unsettled, ACT = { open: ['To\'lanmagan', 'warn'], paid: ["To'langan", 'ok'] };
  const DS = { open: ["Ko'rib chiqilmoqda", 'warn'], resolved: ['Hal qilindi', 'ok'], rejected: ['Rad etildi', ''] };
  box.innerHTML = `<div class="row wrap" style="align-items:flex-start;margin-top:14px;gap:14px">
    <div class="panel grow" style="min-width:320px;margin:0"><h3>Platforma bilan hisob-kitob</h3>
      <div class="row wrap" style="gap:22px"><div><div class="muted small">Aktga kirmagan buyurtmalar</div><b>${u.orders}</b></div><div><div class="muted small">Taom</div><b class="num">${money(u.food)}</b></div>
        <div><div class="muted small">Komissiya ${st.commission_percent}%</div><b class="num">${money(u.commission)}</b></div><div><div class="muted small">O'zimiz olgan naqd</div><b class="num">${money(u.own_cash)}</b></div>
        <div><div class="muted small">Tuzatishlar</div><b class="num">${money(u.adjustments)}</b></div><div><div class="muted small">${u.payable >= 0 ? 'Platforma sizga to\'laydi' : "Siz platformaga to'laysiz"}</div><b class="num" style="color:var(--${u.payable >= 0 ? 'accent' : 'warn'})">${money(Math.abs(u.payable))}</b></div></div>
      <table class="list" style="margin-top:10px"><tr><th>Akt</th><th>Davr oxiri</th><th class="right">Buyurtma</th><th class="right">Summa</th><th>Holat</th><th></th></tr>
        ${st.acts.map((a) => `<tr><td>#${a.id}</td><td>${esc(a.date_to)}</td><td class="right">${a.orders}</td><td class="right num">${money(a.payable)}</td><td><span class="chip ${ACT[a.status]?.[1] || ''}">${ACT[a.status]?.[0] || a.status}</span></td><td class="right"><button class="btn sm" data-a="dActOpen" data-id="${a.id}">Ochish</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Hali akt yo\'q</td></tr>'}</table></div>
    <div class="panel grow" style="min-width:320px;margin:0"><h3>Shikoyat va nizolar</h3>
      ${ds.map((d) => `<div class="line" style="align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)"><div class="grow"><div><b>#${d.id}</b> · D-${d.order_id ?? '—'} · ${DPARTY[d.opened_by]}${d.against ? ' → ' + DPARTY[d.against] : ''} <span class="chip ${DS[d.status]?.[1] || ''}">${d.appeal_status === 'open' ? "E'tiroz ko'rilmoqda" : DS[d.status]?.[0]}</span></div>
        <div class="small"><b>${esc(d.category_name)}</b>: ${esc(d.text)}${d.amount ? ` · da'vo ${som(d.amount)}` : ''}</div>
        ${d.status !== 'open' ? `<div class="small muted">Qaror: aybdor — ${DPARTY[d.guilty] || '—'}${d.recover && d.appeal_status !== 'accepted' ? `, sizdan ${som(d.recover)} ushlanadi` : ''}. ${esc(d.resolution)}${d.guilty !== 'restaurant' ? '' : d.appeal_status === 'accepted' ? " E'tirozingiz qabul qilindi." : d.appeal_status === 'rejected' ? " E'tirozingiz rad etildi." : ''}</div>` : ''}
        <div class="row" style="gap:6px;margin-top:6px">${d.status === 'open' || d.appeal_status === 'open' ? `<button class="btn sm" data-a="dDNote" data-id="${d.id}">Javob / isbot</button>` : ''}${d.can_appeal ? `<button class="btn sm primary" data-a="dDAppeal" data-id="${d.id}">E'tiroz bildirish</button>` : ''}</div></div></div>`).join('') || '<div class="muted small">Shikoyat yo\'q</div>'}</div></div>`;
}
// Rasm (ixtiyoriy isbot) — modal ichidagi fayl tanlash, ≈1200 px JPEG
const photoInput = () => `<label>Rasm (ixtiyoriy)</label><input type="file" accept="image/*" data-photo>`;
const readPhoto = (file) => new Promise((resolve) => {
  if (!file) return resolve('');
  const fr = new FileReader(), im = new Image();
  fr.onload = () => { im.src = fr.result; };
  im.onload = () => { const k = Math.min(1, 1200 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.7)); };
  im.onerror = () => resolve('');
  fr.readAsDataURL(file);
});
let pickedPhoto = null;
document.addEventListener('change', (e) => { if (e.target.matches('input[data-photo]')) pickedPhoto = e.target.files[0] || null; });
A.dDispute = async (el) => {
  pickedPhoto = null;
  const v = await modal(`<h2>D-${el.dataset.id} · shikoyat</h2><label>Kimga nisbatan</label><select name="against">${el.dataset.c === '1' ? '<option value="courier">Kuryerga</option>' : ''}<option value="customer">Mijozga</option><option value="platform">Platformaga</option></select>
    <label>Muammo</label><select name="category"><option value="rude">Qo'pol muomala</option><option value="late">Kuryer kech keldi</option><option value="damaged">Paket shikastlangan</option><option value="customer_abuse">Mijoz bilan muammo</option><option value="payment">To'lov muammosi</option><option value="other">Boshqa</option></select>
    <label>Tavsif</label><input name="text" maxlength="1000">${photoInput()}
    <p class="muted small">Platforma isbotlarni (rasm, GPS, vaqtlar) ko'rib chiqib qaror chiqaradi.</p><div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Yuborish</button></div>`);
  if (!v) return;
  const photo = await readPhoto(pickedPhoto);
  if (await run(() => api('POST', '/api/delivery/disputes', { order_id: Number(el.dataset.id), against: v.against, category: v.category, text: v.text, ...(photo ? { photo } : {}) }))) { toast('Shikoyat yuborildi'); renderPlatBlock(); }
};
A.dDNote = async (el) => {
  pickedPhoto = null;
  const v = await modal(`<h2>Nizo #${el.dataset.id} — javob</h2><label>Izoh / tushuntirish</label><input name="text" maxlength="1000">${photoInput()}
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Yuborish</button></div>`);
  if (!v) return;
  const photo = await readPhoto(pickedPhoto);
  if (await run(() => api('POST', `/api/delivery/disputes/${el.dataset.id}/note`, { text: v.text, ...(photo ? { photo } : {}) }))) { toast('Yuborildi'); renderPlatBlock(); }
};
A.dDAppeal = async (el) => {
  const v = await modal(`<h2>Nizo #${el.dataset.id} — e'tiroz</h2><p class="muted small">E'tiroz faqat bir marta bildiriladi. Isbotlaringizni yozing (kamera yozuvi, chek va h.k.).</p><label>E'tiroz</label><input name="text" maxlength="1000">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Yuborish</button></div>`);
  if (v && (await run(() => api('POST', `/api/delivery/disputes/${el.dataset.id}/appeal`, { text: v.text })))) { toast("E'tiroz yuborildi"); renderPlatBlock(); }
};
A.dActOpen = async (el) => {
  const a = await run(() => api('GET', `/api/delivery/settlements/${el.dataset.id}`)); if (!a) return;
  modal(`<h2>Akt #${a.id}</h2><div class="muted small">${esc(a.date_to)} gacha${a.paid_at ? ` · to'langan ${dt(a.paid_at)} (${esc(a.method)})` : ''}</div>
    <table class="list" style="margin-top:10px"><tr><th>Buyurtma</th><th class="right">Taom</th><th class="right">Komissiya</th><th class="right">Naqd (o'zimiz)</th><th class="right">Ulush</th></tr>
    ${a.lines.map((l) => `<tr><td>D-${l.id} <span class="muted small">${l.status === 'delivered' ? 'yetkazildi' : 'olinmadi'}</span></td><td class="right num">${money(l.food)}</td><td class="right num">${money(l.commission)}</td><td class="right num">${money(l.own_cash)}</td><td class="right num">${money(l.net)}</td></tr>`).join('')}
    ${a.adj.map((x) => `<tr><td colspan="4">${esc(x.reason)}</td><td class="right num">${money(x.amount)}</td></tr>`).join('')}
    <tr><td colspan="4"><b>${a.payable >= 0 ? "Platforma sizga to'laydi" : "Siz platformaga to'laysiz"}</b></td><td class="right num"><b>${money(Math.abs(a.payable))}</b></td></tr></table>
    <div class="foot"><button class="btn" onclick="window.print()">Chop etish</button><button class="btn primary" data-m="close">Yopish</button></div>`, { wide: true });
};

const dAct = (path, body) => (el) => run(async () => {
  el.disabled = true;
  try { await api('POST', `/api/delivery/orders/${el.dataset.id}/${path}`, body); } finally { el.disabled = false; }
  await loadDlv(false); renderView();
});
A.dAccept = async (el) => {
  const def = S.dlvSettings?.prep_minutes || 30;
  const v = await modal(`<h2>D-${el.dataset.id} · qabul qilish</h2><p class="muted">Taom necha daqiqada tayyor bo'ladi? Mijoz shu vaqtni ko'radi.</p>
    <div class="row wrap">${[15, 20, 30, 45, 60].map((m) => `<button class="btn ${m === def ? 'primary' : ''}" data-m="val" data-v="${m}">${m} daq</button>`).join('')}</div>
    <div class="foot"><button class="btn" data-m="close">Bekor</button></div>`);
  if (!v) return;
  dAct('accept', { prep_minutes: Number(v) })(el);
};
A.dReject = async (el) => {
  const v = await modal(`<h2>D-${el.dataset.id} · rad etish</h2><p class="muted">Mijoz sababni ko'radi. Oldindan to'langan bo'lsa, pul qaytarilishi belgilanadi.</p>
    <div class="pick">${['Taom tugagan', 'Juda band, ulgurmaymiz', 'Manzil juda uzoq', 'Yopilish vaqti'].map((r) => `<button data-m="val" data-v="${r}"><b>${r}</b></button>`).join('')}</div>
    <label>Boshqa sabab</label><input name="r" maxlength="200"><div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn danger" data-m="ok">Rad etish</button></div>`);
  const reason = typeof v === 'string' ? v : v?.r?.trim();
  if (!reason) return v && toast('Sababni yozing', true);
  dAct('reject', { reason })(el);
};
A.dReady = dAct('ready');
A.dOwn = async (el) => { if (await confirmBox("O'zimiz yetkazamiz", 'Bu buyurtma kuryerlarga taklif qilinmaydi — o\'z kuryeringiz olib boradi.', 'Ha')) dAct('own')(el); };
A.dClosePos = dAct('close-pos');
A.dDispatch = dAct('dispatch');
A.dDelivered = async (el) => {
  const o = S.dlv.find((x) => x.id === Number(el.dataset.id));
  const cash = o ? o.total - (o.payment_status === 'paid' ? o.paid_amount : 0) : 0;
  if (cash > 0 && !(await confirmBox('Yetkazildi', `Kuryer mijozdan ${som(cash)} naqd oldimi? Chek yopiladi va naqd kassaga yoziladi.`, 'Ha, yetkazildi'))) return;
  dAct('delivered')(el);
};
A.dNoShow = async (el) => {
  if (!(await confirmBox('Mijoz olmadi', "Kuryer qo'ng'iroq qildi va 10 daqiqa kutdimi? Mijoz keyingi buyurtmalarda faqat oldindan to'lov bilan buyurtma bera oladi.", 'Ha, olmadi', true))) return;
  dAct('no_show')(el);
};

// ---------- Boshqaruv: yetkazib berish sozlamalari ----------
ADMIN_TABS.splice(ADMIN_TABS.findIndex((t) => t[0] === 'settings'), 0, ['delivery', 'Yetkazib berish']);
const SUB_NAME = { trial: 'Sinov davri', active: 'Faol', grace: "Imtiyozli davr (to'lov kutilmoqda)", expired: 'Muddati tugagan', blocked: 'Bloklangan', disabled: 'Ulanmagan' };
ADMIN_VIEWS.delivery = async (main, head) => {
  const s = await api('GET', '/api/delivery/settings').catch((e) => (toast(e.message, true), null));
  if (!s || S.adminTab !== 'delivery') return;
  S.dlvSettings = s;
  const sub = s.subscription;
  const num = (k, label, hint = '') => `<div><label>${label}</label><input id="d-${k}" type="number" inputmode="numeric" value="${s[k]}">${hint ? `<div class="muted small">${hint}</div>` : ''}</div>`;
  main.innerHTML = head + `<div class="panel" style="max-width:760px"><div class="row wrap"><h3 style="margin:0">Mijoz ilovasida sotish</h3><div class="grow"></div>
      <span class="chip ${['trial', 'active'].includes(sub.status) ? 'ok' : sub.status === 'grace' ? 'warn' : 'danger'}">Obuna: ${SUB_NAME[sub.status] || sub.status}${sub.days_left != null && ['trial', 'active'].includes(sub.status) ? ` · ${sub.days_left} kun` : ''}</span></div>
    ${sub.status === 'disabled' ? '<p class="muted">Yetkazib berish xizmati hali ulanmagan. Ulash uchun platforma bilan bog\'laning (ega kabineti → tarif).</p>' : ''}
    <label class="chk"><input type="checkbox" id="d-enabled" ${s.enabled ? 'checked' : ''}> Ilovada ko'rinsin (yetkazib berish yoqilgan)</label>
    <label class="chk"><input type="checkbox" id="d-open" ${s.open ? 'checked' : ''}> Hozir buyurtma qabul qilinadi (vaqtincha to'xtatish uchun o'chiring)</label>
    <label class="chk"><input type="checkbox" id="d-pickup" ${s.pickup ? 'checked' : ''}> Mijoz o'zi olib ketishi mumkin (yetkazish narxisiz)</label>
    <div id="d-lic" ${s.place_type === 'dorixona' ? '' : 'hidden'}><div class="paygrid"><div><label>Dorixona litsenziyasi raqami</label><input id="d-license_no" maxlength="60" value="${esc(s.license_no || '')}"></div>
      <div><label>Litsenziya amal qilish muddati</label><input id="d-license_until" type="date" value="${esc(s.license_until || '')}"></div></div>
      <p class="muted small">Dorixona ilovada faqat platforma litsenziyani tekshirgandan keyin ko'rinadi. Retseptli dorilar ilovada sotilmaydi (Menyu → "Retsept bilan beriladi").</p></div>
    <label>Kim yetkazadi</label><select id="d-delivery_by"><option value="platform" ${s.delivery_by === 'platform' ? 'selected' : ''}>Platforma kuryerlari (avtomatik taqsimlanadi)</option>
      <option value="own" ${s.delivery_by === 'own' ? 'selected' : ''}>O'zimizning kuryerlar</option></select>
    <div class="row wrap" style="margin-top:8px"><span class="muted small grow">Restoran joylashuvi (kuryerlarni yaqinidan topish uchun): ${s.lat != null ? `<b>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</b>` : '<b style="color:var(--warn)">belgilanmagan</b>'}</span>
      <button class="btn sm" data-a="dlvGeo">📍 Shu yerni belgilash</button></div>
    <div class="paygrid"><div><label>Turi</label><select id="d-place_type">${PLACE_TYPES.map(([k, n]) => `<option value="${k}" ${s.place_type === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${num('prep_minutes', 'Odatiy tayyorlash vaqti (daq)')}</div>
    <label>Manzil (mijozga ko'rinadi)</label><input id="d-address" maxlength="200" value="${esc(s.address)}">
    <label>Qisqa tavsif</label><input id="d-description" maxlength="300" value="${esc(s.description)}" placeholder="Masalan: Milliy taomlar, osh va somsa">
    <div class="paygrid">${num('min_order', "Minimal buyurtma (so'm)")}${num('delivery_fee', "Yetkazish narxi (so'm)")}</div>
    <h3 style="margin-top:18px">To'lov qoidalari</h3>
    <label>Rejim</label><select id="d-prepay_mode">
      <option value="mixed" ${s.prepay_mode === 'mixed' ? 'selected' : ''}>Aralash (tavsiya): yangi mijoz oldindan, ishonchli mijoz naqd</option>
      <option value="full" ${s.prepay_mode === 'full' ? 'selected' : ''}>Faqat oldindan to'lov</option>
      <option value="cash" ${s.prepay_mode === 'cash' ? 'selected' : ''}>Naqd ham mumkin (limitgacha)</option></select>
    <div class="paygrid">${num('trusted_after', 'Ishonchli mijoz: nechta muvaffaqiyatli buyurtmadan keyin', '0 marta olmagan bo\'lishi ham shart')}
      ${num('partial_percent', 'Ishonchli mijozdan ham qisman oldindan (%)', '0 — to\'liq naqd mumkin; 20–30 tavsiya')}
      ${num('cash_limit', "Naqd limiti (so'm)", 'Bundan qimmat buyurtma faqat oldindan')}
      ${num('expensive_limit', "Qimmat buyurtma chegarasi (so'm)", "Qaytarib bo'lmaydigan taomli bunday buyurtma — 100% oldindan")}</div>
    <p class="muted small">Qaysi taom qaytarib bo'lmaydi va qaysi biri ilovada sotiladi — Menyu bo'limida har bir taomda belgilanadi. Platforma komissiyasi taom summasidan olinadi.</p>
    <button class="btn primary" style="margin-top:12px" data-a="saveDlv">Saqlash</button></div>`;
  $('#d-place_type').onchange = (e) => { $('#d-lic').hidden = e.target.value !== 'dorixona'; };
};
A.dlvGeo = (el) => {
  if (!navigator.geolocation) return toast("Brauzer joylashuvni bermayapti", true);
  el.textContent = 'Aniqlanmoqda…';
  navigator.geolocation.getCurrentPosition((p) => { S.dlvGeo = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }; el.textContent = `✓ ${S.dlvGeo.lat}, ${S.dlvGeo.lng} — Saqlash ni bosing`; },
    () => { el.textContent = '📍 Shu yerni belgilash'; toast("Joylashuvga ruxsat berilmadi", true); }, { enableHighAccuracy: true, timeout: 10000 });
};
A.saveDlv = () => run(async () => {
  const v = (k) => $('#d-' + k);
  const body = { pickup: v('pickup').checked, license_no: v('license_no').value, license_until: v('license_until').value, delivery_by: v('delivery_by').value, ...(S.dlvGeo ? S.dlvGeo : {}), enabled: v('enabled').checked, open: v('open').checked, place_type: v('place_type').value, address: v('address').value, description: v('description').value, prepay_mode: v('prepay_mode').value };
  ['prep_minutes', 'min_order', 'delivery_fee', 'trusted_after', 'partial_percent', 'cash_limit', 'expensive_limit'].forEach((k) => { body[k] = Number(v(k).value) || 0; });
  S.dlvSettings = await api('POST', '/api/delivery/settings', body); S.dlvGeo = null;
  await loadBoot(); render(); toast('Saqlandi');
});

// ---------- 9-etap: buyurtmani o'zgartirish (mahsulot yo'q / og'irlik / almashtirish) ----------
A.dAdjust = async (el) => {
  const o = S.dlv.find((x) => x.id === Number(el.dataset.id)); if (!o) return;
  const prods = (S.boot.products || []).filter((p) => p.active !== 0);
  const kgOf = (it) => (it.weight_g ? `<input name="w${o.items.indexOf(it)}" type="number" step="10" min="10" value="${it.weight_g}" style="width:110px"> g` : '');
  const v = await modal(`<h2>D-${o.id} · o'zgartirish</h2><p class="muted small">${SUBST[o.substitution] || "Mijoz tanlovi ko'rsatilmagan"}. Qabul qilishdan oldin o'zgartiring — mijozga xabar boradi, ortiqcha to'lov qaytariladi.</p>
    <table class="list">${o.items.map((it, i) => `<tr><td>${esc(it.name)}${it.weight_g ? '' : ` × ${it.qty}`}</td><td>${kgOf(it)}</td>
      <td><select name="a${i}"><option value="">— o'zgarmaydi —</option><option value="remove">Olib tashlash</option>${prods.filter((p) => p.id !== it.product_id).map((p) => `<option value="${p.id}">→ ${esc(p.name)} (${money(p.price)}${p.sold_by === 'kg' ? '/kg' : ''})</option>`).join('')}</select></td></tr>`).join('')}</table>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`, { wide: true });
  if (!v) return;
  const items = [];
  o.items.forEach((it, i) => {
    const a = v['a' + i], w = Number(v['w' + i]);
    if (a === 'remove') items.push({ i, remove: true });
    else if (a) items.push({ i, replace_product_id: Number(a), ...(w ? { weight_g: w } : {}) });
    else if (it.weight_g && w && w !== it.weight_g) items.push({ i, weight_g: w });
  });
  if (!items.length) return;
  await run(async () => { await api('POST', `/api/delivery/orders/${o.id}/adjust`, { items }); toast("O'zgartirildi, mijozga xabar yuborildi"); await loadDlv(false); renderView(); });
};

// ---------- 9-etap: kechki chegirma ----------
A.dDeals = async () => {
  const list = await api('GET', '/api/deals').catch((e) => (toast(e.message, true), null)); if (!list) return;
  const prods = (S.boot.products || []).filter((p) => p.sold_by !== 'kg');
  const end = new Date(Date.now() + 3 * 36e5); const until = `${String(end.getHours()).padStart(2, '0')}:00`;
  const v = await modal(`<h2>🌙 Kechki chegirma</h2><p class="muted small">Kun oxirida ortgan taomni chegirma bilan soting: mijoz ilovasida alohida bo'limda ko'rinadi, faqat oldindan to'lov.</p>
    ${list.length ? `<table class="list">${list.map((d) => `<tr><td>${esc(d.product?.name || '')}</td><td>-${d.percent}% · ${money(d.price)}</td><td>${d.sold}/${d.qty_total} sotildi</td>
      <td class="muted small">${hhmm(d.ends_at)} gacha</td><td>${d.live ? `<button class="btn sm danger" data-m="val" data-v="stop:${d.id}">To'xtatish</button>` : '<span class="chip">tugagan</span>'}</td></tr>`).join('')}</table>` : ''}
    <h3 style="margin-top:14px">Yangi chegirma</h3>
    <label>Taom</label><select name="product_id">${prods.map((p) => `<option value="${p.id}">${esc(p.name)} — ${money(p.price)}</option>`).join('')}</select>
    <div class="paygrid"><div><label>Soni</label><input name="qty" type="number" min="1" value="5"></div><div><label>Chegirma %</label><input name="percent" type="number" min="10" max="90" value="40"></div>
      <div><label>Qachongacha</label><input name="until" type="time" value="${until}"></div></div>
    <div class="foot"><button class="btn" data-m="close">Yopish</button><button class="btn primary" data-m="ok">E'lon qilish</button></div>`, { wide: true });
  if (!v) return;
  if (typeof v === 'string' && v.startsWith('stop:')) { await run(() => api('POST', `/api/deals/${v.slice(5)}/stop`)); toast("To'xtatildi"); return A.dDeals(); }
  const r = await run(() => api('POST', '/api/deals', { product_id: Number(v.product_id), qty: Number(v.qty), percent: Number(v.percent), until: v.until }));
  if (r) { toast(`E'lon qilindi: ${money(r.price)} so'm (${r.qty_total} ta)`); A.dDeals(); }
};
