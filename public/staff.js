// Dasturxon POS — 3-etap: Bronlar, Mijozlar, Xodimlar (ish vaqti va maosh), keshbek va Telegram sozlamalari
'use strict';

S.upcoming = [];
const fmtPhone = (p) => (p && p.length === 12 ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : p || '');
const bdayNear = (bd) => {
  if (!bd) return false;
  const [, m, d] = bd.split('-').map(Number); const now = new Date();
  return [-1, 0, 1].some((y) => { const t = new Date(now.getFullYear() + y, m - 1, d); return Math.abs(t - now) <= 3 * 864e5; });
};
const loadUpcoming = async () => { S.upcoming = await api('GET', '/api/reservations/upcoming').catch(() => []); };

HOOKS.onStart = loadUpcoming;
HOOKS.onChange = async (types) => { if (types.includes('reservations') || types.includes('orders')) await loadUpcoming(); };

// Sarlavhadagi "Ishga keldim / ketdim" tugmasi
HOOKS.header = () => {
  if (S.boot.business.mirror) return '';
  const c = S.boot.staff?.clock;
  return `<button class="btn sm ${c ? '' : 'warn'}" data-a="clock" title="Ish vaqtini belgilash">${c ? `⏱ Ishda · ${hhmm(c)}` : '⏱ Ishga keldim'}</button>`;
};
A.clock = async () => {
  const c = S.boot.staff?.clock;
  if (c && !(await confirmBox('Ishdan ketish', `Ish vaqtingiz ${hhmm(c)} dan boshlangan. Ishdan ketganingizni belgilaymizmi?`, 'Ha, ketdim'))) return;
  run(async () => { S.boot.staff = await api('POST', '/api/time/clock'); render(); toast(S.boot.staff.clock ? 'Ish boshlandi' : 'Ish tugadi. Rahmat!'); });
};

// Zalda bron belgisi
HOOKS.tableBadge = (t) => {
  const r = S.upcoming.find((x) => x.table_id === t.id && new Date(x.start_at) - Date.now() < 3 * 36e5);
  if (!r) return '';
  const late = new Date(r.start_at) < Date.now();
  return `<span class="chip ${late ? 'danger' : 'info'}">${r.type === 'banket' ? 'Banket' : 'Bron'} ${hhmm(r.start_at)}</span>`;
};

// Buyurtmada mijoz
HOOKS.ticketCustomer = (o) => {
  const dep = o.deposit ? `<span class="chip ok">Zaklad ${money(o.deposit)}</span>` : '';
  if (!o.customer_id) return `<div class="row" style="margin-top:8px;gap:6px"><button class="btn sm" data-a="custAttach">👤 Mijoz biriktirish</button>${dep}</div>`;
  return `<div class="row wrap" style="margin-top:8px;gap:6px"><span class="chip info">👤 ${esc(o.customer_name || fmtPhone(o.customer_phone))}</span>
    <span class="chip">Bonus: ${money(o.customer_bonus)}</span>${bdayNear(o.customer_birthday) ? '<span class="chip warn">🎂 Tug\'ilgan kuni</span>' : ''}${dep}
    <button class="btn sm ghost" data-a="custDetach" title="Olib tashlash">✕</button></div>`;
};
A.custAttach = async () => {
  const r = await modal(`<h2>Mijozni biriktirish</h2><label>Telefon raqami</label><input name="phone" inputmode="tel" placeholder="90 123 45 67">
    <label>Ismi (yangi mijoz bo'lsa)</label><input name="name">
    <p class="muted small">Mijoz bazada bo'lmasa, avtomatik qo'shiladi. Shaxsiy chegirmasi bo'lsa, o'zi qo'llanadi va to'lovdan keyin keshbek yig'iladi.</p>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Biriktirish</button></div>`);
  if (!r) return;
  run(async () => { upsertOrder(await api('POST', `/api/orders/${S.orderId}/customer`, { phone: r.phone, name: r.name })); renderTicket(); toast('Mijoz biriktirildi'); });
};
A.custDetach = () => run(async () => { upsertOrder(await api('POST', `/api/orders/${S.orderId}/customer`, { remove: true })); renderTicket(); });

// Boshqaruv → Sozlamalar: keshbek, Telegram, zaxira
HOOKS.adminSettings = async (main) => {
  const l = await api('GET', '/api/admin/loyalty').catch(() => null);
  if (!l || S.adminTab !== 'settings') return;
  main.insertAdjacentHTML('beforeend', `<div class="row wrap" style="align-items:flex-start">
    <div class="panel" style="max-width:560px;flex:1;min-width:300px"><h3>Sodiqlik dasturi</h3>
      <label>Keshbek (%) — mijoz to'lagan pulning shu qismi bonus bo'lib qaytadi</label><input id="l-cb" type="number" value="${l.cashback_percent}">
      <p class="muted small">Bonus keyingi tashrifda to'lov sifatida ishlatiladi. Shaxsiy chegirma Mijozlar bo'limida beriladi.</p>
      <button class="btn primary" data-a="saveLoyalty">Saqlash</button></div>
    <div class="panel" style="max-width:560px;flex:1;min-width:300px"><h3>Egaga Telegram hisobot</h3>
      <p class="muted small">1) Telegram'da @BotFather → /newbot → bot yarating va tokenni oling. 2) Botingizga /start yozing. 3) Chat ID ni @userinfobot dan oling.</p>
      <label>Bot token ${l.tg_token_set ? '<span class="chip ok">saqlangan</span>' : ''}</label><input id="l-tok" placeholder="${l.tg_token_set ? "o'zgartirish uchun yangisini kiriting" : '123456:ABC...'}">
      <label>Chat ID</label><input id="l-chat" value="${esc(l.tg_chat)}">
      <label>Kunlik hisobot vaqti</label><input id="l-time" type="time" value="${esc(l.tg_time)}">
      <p class="muted small">Har kuni shu vaqtda kunlik hisobot, smena yopilganda Z-hisobot keladi (kamomad, bekor qilinganlar, kam qolgan masalliqlar bilan).</p>
      <div class="row wrap"><button class="btn primary" data-a="saveTg">Saqlash</button><button class="btn" data-a="testTg">Sinov xabari</button>${l.tg_token_set ? '<button class="btn danger" data-a="clearTg">O\'chirish</button>' : ''}</div></div>
    <div class="panel" style="max-width:560px;flex:1;min-width:300px"><h3>Zaxira nusxa</h3>
      <p class="muted small">Baza har kuni va har smena yopilganda avtomatik <code>data/backups</code> papkasiga saqlanadi (oxirgi 40 ta). Muhim: vaqti-vaqti bilan fleshkaga ham ko'chiring.</p>
      <button class="btn" data-a="backupNow">Hozir zaxira olish</button></div></div>`);
  const sy = await api('GET', '/api/admin/sync').catch(() => null);
  if (!sy || sy.mode === 'cloud' || S.adminTab !== 'settings') return;
  const ago2 = sy.last_ok ? Math.round((Date.now() - new Date(sy.last_ok)) / 60000) : null;
  main.insertAdjacentHTML('beforeend', `<div class="panel" style="max-width:760px"><h3>Bulut sinxronizatsiya ${sy.enabled ? (sy.last_error ? '<span class="chip warn">internet yo\'q / xato</span>' : '<span class="chip ok">ulangan</span>') : '<span class="chip">ulanmagan</span>'}</h3>
    ${sy.enabled ? `<p>Bulut: <b>${esc(sy.cloud_name)}</b> · <span class="muted">${esc(sy.url)}</span></p>
      <p class="muted">Oxirgi sinxron: ${sy.last_ok ? (ago2 < 1 ? 'hozirgina' : ago2 + ' daqiqa oldin') : '—'} · Navbatda: <b>${sy.pending}</b> ta o'zgarish${sy.initial ? ' · boshlang\'ich nusxa yuborilmoqda' : ''}</p>
      ${sy.last_error ? `<p class="small" style="color:var(--warn)">Oxirgi xato: ${esc(sy.last_error)}. Internet qaytganda navbat o'zi yuboriladi — kassa ishlashda davom etadi.</p>` : ''}
      <div class="row"><button class="btn" data-a="syncRefresh">Yangilash</button><button class="btn danger" data-a="syncOff">Uzish</button></div>`
    : `<p class="muted small">Restoran kompyuteri internetga ulangan bo'lsa, barcha savdo, smena, ombor va hisobotlar bulutga nusxalanadi: ega uydan ko'radi,
      kompyuter buzilsa ma'lumot yo'qolmaydi. Internet uzilsa kassa to'xtamaydi — o'zgarishlar navbatda kutadi.
      Ulash kalitini ega kabinetidan (bulut serverda → filial → "Lokal serverni ulash") oling.</p>
      <div class="paygrid"><div><label>Bulut manzili</label><input id="sy-url" placeholder="https://pos.sizningdomen.uz"></div><div><label>Ulash kaliti</label><input id="sy-key" placeholder="dxs_..."></div></div>
      <button class="btn primary" style="margin-top:12px" data-a="syncOn">Ulash</button>`}</div>`);
};
A.syncOn = () => run(async () => { const r = await api('POST', '/api/admin/sync', { url: $('#sy-url').value.trim(), key: $('#sy-key').value.trim() }); toast(`Ulandi: ${r.cloud}`); renderView(); });
A.syncOff = async () => { if (await confirmBox('Bulutdan uzish', "Sinxronizatsiya to'xtaydi. Bulutdagi mavjud nusxa o'chmaydi.", 'Uzish', true)) run(async () => { await api('POST', '/api/admin/sync', { disable: true }); renderView(); }); };
A.syncRefresh = () => renderView();
A.saveLoyalty = () => run(async () => { await api('POST', '/api/admin/loyalty', { cashback_percent: Number($('#l-cb').value) || 0 }); toast('Saqlandi'); });
A.saveTg = () => run(async () => { await api('POST', '/api/admin/loyalty', { tg_token: $('#l-tok').value.trim() || undefined, tg_chat: $('#l-chat').value.trim(), tg_time: $('#l-time').value }); renderView(); toast('Saqlandi'); });
A.clearTg = () => run(async () => { await api('POST', '/api/admin/loyalty', { tg_token: '-' }); renderView(); toast("Telegram o'chirildi"); });
A.testTg = () => run(async () => { await api('POST', '/api/admin/telegram/test'); toast('Sinov xabari yuborildi'); });
A.backupNow = () => run(async () => { const r = await api('POST', '/api/admin/backup'); toast(`Saqlandi: ${r.file}`); });

// ---------- BRONLAR ----------
S.resDate = ymd(new Date());
const RES_STATUS = { active: ['Kutilmoqda', 'info'], arrived: ['Keldi', 'ok'], done: ['Yakunlandi', ''], cancelled: ['Bekor', 'danger'], noshow: ['Kelmadi', 'warn'] };
VIEWS.reservations = async function viewReservations(main) {
  const list = await api('GET', `/api/reservations?date=${S.resDate}`).catch((e) => (toast(e.message, true), []));
  if (S.view !== 'reservations') return;
  const d = new Date(`${S.resDate}T00:00:00`);
  const active = list.filter((r) => r.status === 'active');
  main.innerHTML = `<div class="row wrap" style="margin-bottom:14px">
      <button class="btn" data-a="resDay" data-d="-1">←</button><input type="date" id="res-date" value="${S.resDate}" style="max-width:170px"><button class="btn" data-a="resDay" data-d="1">→</button>
      <button class="btn sm" data-a="resDay" data-d="0">Bugun</button>
      <span class="muted">${['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'][d.getDay()]} · ${active.length} ta faol bron · ${active.reduce((s, r) => s + r.guests, 0)} mehmon</span>
      <div class="grow"></div>${can(...CASHR) ? `<button class="btn primary" data-a="resEdit" data-t="stol">+ Stol bron</button><button class="btn" data-a="resEdit" data-t="banket">+ Banket</button>` : ''}</div>
    <div class="panel"><table class="list"><tr><th>Vaqt</th><th>Turi</th><th>Mijoz</th><th>Stol</th><th class="right">Mehmon</th><th class="right">Zaklad</th><th>Izoh</th><th>Holat</th><th></th></tr>
    ${list.map((r) => { const [sn, sc] = RES_STATUS[r.status]; return `<tr class="${['cancelled', 'noshow', 'done'].includes(r.status) ? 'off' : ''}">
      <td><b>${hhmm(r.start_at)}</b><div class="muted small">${Math.round(r.duration_min / 6) / 10} soat</div></td>
      <td>${r.type === 'banket' ? `<span class="chip warn">Banket</span>${r.per_person ? `<div class="muted small">${money(r.per_person)}/kishi</div>` : ''}` : 'Stol'}</td>
      <td><b>${esc(r.name)}</b><div class="muted small">${fmtPhone(r.phone)}</div></td><td>${esc(r.table_name || '—')}</td><td class="right">${r.guests}</td>
      <td class="right num">${r.deposit ? money(r.deposit) + (r.deposit_refunded ? ' <span class="chip">qaytarildi</span>' : '') : '—'}</td>
      <td class="muted small" style="max-width:220px">${esc(r.note)}</td><td><span class="chip ${sc}">${sn}</span></td>
      <td class="right">${r.status === 'active' ? `<button class="btn sm primary" data-a="resStatus" data-id="${r.id}" data-s="arrived">Keldi</button>
        ${can(...CASHR) ? `<button class="btn sm" data-a="resEdit" data-id="${r.id}">✎</button>` : ''}<button class="btn sm" data-a="resStatus" data-id="${r.id}" data-s="noshow">Kelmadi</button>
        <button class="btn sm danger" data-a="resStatus" data-id="${r.id}" data-s="cancelled">Bekor</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">Bu kunga bron yo\'q</td></tr>'}</table></div>`;
  S.resList = list;
  main.querySelector('#res-date').onchange = (e) => { S.resDate = e.target.value || ymd(new Date()); renderView(); };
};
A.resDay = (el) => { const n = Number(el.dataset.d); const d = n ? new Date(`${S.resDate}T12:00:00`) : new Date(); d.setDate(d.getDate() + n); S.resDate = ymd(d); renderView(); };
A.resEdit = async (el) => {
  const id = Number(el.dataset.id) || null;
  const r = id ? S.resList.find((x) => x.id === id) : { type: el.dataset.t, guests: el.dataset.t === 'banket' ? 20 : 2, duration_min: el.dataset.t === 'banket' ? 240 : 120, start_at: `${S.resDate}T19:00:00` };
  const st = new Date(r.start_at);
  const tbl = S.boot.halls.map((h) => `<optgroup label="${esc(h.name)}">${S.boot.tables.filter((t) => t.hall_id === h.id).map((t) => `<option value="${t.id}" ${t.id === r.table_id ? 'selected' : ''}>${esc(t.name)} (${t.seats})</option>`).join('')}</optgroup>`).join('');
  const v = await modal(`<h2>${id ? 'Bronni tahrirlash' : r.type === 'banket' ? 'Yangi banket' : 'Yangi stol bron'}</h2>
    <div class="paygrid"><div><label>Mijoz ismi</label><input name="name" value="${esc(r.name || '')}"></div><div><label>Telefon</label><input name="phone" inputmode="tel" value="${esc(r.phone ? r.phone.slice(3) : '')}" placeholder="90 123 45 67"></div>
    <div><label>Sana</label><input name="date" type="date" value="${ymd(st)}"></div><div><label>Vaqt</label><input name="time" type="time" value="${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}"></div>
    <div><label>Mehmonlar</label><input name="guests" type="number" inputmode="numeric" value="${r.guests}"></div><div><label>Davomiyligi (daqiqa)</label><input name="duration_min" type="number" value="${r.duration_min}"></div>
    <div><label>Stol / joy ${r.type === 'banket' ? '(ixtiyoriy)' : ''}</label><select name="table_id">${r.type === 'banket' ? '<option value="">— butun zal / keyin —</option>' : ''}${tbl}</select></div>
    ${r.type === 'banket' ? `<div><label>Kishi boshiga narx</label><input name="per_person" type="number" inputmode="numeric" value="${r.per_person || ''}"></div>` : '<div></div>'}
    ${id ? '' : `<div><label>Zaklad (oldindan to'lov)</label><input name="deposit" type="number" inputmode="numeric" placeholder="0"></div>
    <div><label>Zaklad qanday to'landi</label><select name="deposit_method">${METHODS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>`}</div>
    <label>${r.type === 'banket' ? 'Menyu va izoh' : 'Izoh'}</label><textarea name="note" rows="3">${esc(r.note || '')}</textarea>
    ${id ? '' : '<p class="muted small">Naqd zaklad kassaga kirim sifatida yoziladi (smena ochiq bo\'lishi kerak). Mehmon kelganda zaklad hisobdan avtomatik ayiriladi.</p>'}
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`, { wide: true });
  if (!v) return;
  run(async () => {
    await api('POST', '/api/reservations', { ...(id ? { id } : {}), type: r.type, name: v.name, phone: v.phone, date: v.date, time: v.time, guests: Number(v.guests), duration_min: Number(v.duration_min),
      table_id: Number(v.table_id) || null, per_person: Number(v.per_person) || 0, deposit: Number(v.deposit) || 0, deposit_method: v.deposit_method, note: v.note });
    S.resDate = v.date; renderView(); toast('Bron saqlandi');
  });
};
A.resStatus = async (el) => {
  const r = S.resList.find((x) => x.id === Number(el.dataset.id)); const s = el.dataset.s;
  let refund = false;
  if (s === 'cancelled') {
    const v = await modal(`<h2>Bronni bekor qilish</h2><p>${esc(r.name)} · ${hhmm(r.start_at)}</p>
      ${r.deposit ? `<label style="display:flex;gap:10px;align-items:center;color:var(--text)"><input type="checkbox" name="refund" style="width:22px;height:22px" checked> Zaklad (${som(r.deposit)}) mijozga qaytarilsin</label>` : ''}
      <div class="foot"><button class="btn" data-m="close">Orqaga</button><button class="btn danger" data-m="ok">Bekor qilish</button></div>`);
    if (!v) return; refund = !!v.refund;
  } else if (s === 'noshow' && !(await confirmBox('Mijoz kelmadi', r.deposit ? `Zaklad (${som(r.deposit)}) qaytarilmaydi.` : 'Bron "kelmadi" deb belgilanadi.', 'Belgilash'))) return;
  run(async () => {
    const res = await api('POST', `/api/reservations/${r.id}/status`, { status: s, refund });
    if (res.order_id) { await loadOrders(); openOrder(res.order_id); toast('Buyurtma ochildi'); } else renderView();
  });
};

// ---------- MIJOZLAR ----------
S.custQ = '';
VIEWS.customers = async function viewCustomers(main) {
  const list = await api('GET', '/api/customers' + (S.custQ ? '?q=' + encodeURIComponent(S.custQ) : '')).catch(() => []);
  if (S.view !== 'customers') return;
  S.custList = list;
  main.innerHTML = `<div class="row wrap" style="margin-bottom:12px"><input id="cust-q" placeholder="Ism yoki telefon bo'yicha qidirish..." value="${esc(S.custQ)}" style="max-width:320px">
      <div class="grow"></div><button class="btn primary" data-a="custEdit" data-id="">+ Mijoz</button></div>
    <div class="panel"><table class="list"><tr><th>Mijoz</th><th>Telefon</th><th class="right">Tashrif</th><th class="right">Sarflagan</th><th class="right">O'rt. chek</th><th class="right">Bonus</th><th>Chegirma</th><th>Oxirgi tashrif</th><th></th></tr>
    ${list.map((c) => `<tr><td><b>${esc(c.name || '—')}</b>${bdayNear(c.birthday) ? ' <span class="chip warn">🎂</span>' : ''}</td><td>${fmtPhone(c.phone)}</td><td class="right">${c.visits}</td>
      <td class="right num">${money(c.spent)}</td><td class="right num">${c.visits ? money(Math.round(c.spent / c.visits)) : '—'}</td><td class="right num">${money(c.bonus)}</td>
      <td>${c.discount_percent ? `<span class="chip ok">${c.discount_percent}%</span>` : ''}</td><td class="muted">${c.last_visit ? dt(c.last_visit) : '—'}</td>
      <td class="right"><button class="btn sm" data-a="custView" data-id="${c.id}">Batafsil</button><button class="btn sm" data-a="custEdit" data-id="${c.id}">✎</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Mijoz topilmadi</td></tr>'}</table></div>`;
  const q = main.querySelector('#cust-q');
  q.oninput = () => { clearTimeout(S.custT); S.custT = setTimeout(() => { S.custQ = q.value.trim(); renderView().then?.(() => { const n = $('#cust-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 300); };
};
A.custEdit = async (el) => {
  const id = Number(el.dataset.id) || null; const c = id ? S.custList.find((x) => x.id === id) : {};
  const mgr = can('admin', 'menejer');
  const v = await modal(`<h2>${id ? 'Mijozni tahrirlash' : 'Yangi mijoz'}</h2>
    <div class="paygrid"><div><label>Ismi</label><input name="name" value="${esc(c.name || '')}"></div><div><label>Telefon</label><input name="phone" inputmode="tel" value="${esc(c.phone ? c.phone.slice(3) : '')}" placeholder="90 123 45 67"></div>
    <div><label>Tug'ilgan sana</label><input name="birthday" type="date" value="${esc(c.birthday || '')}"></div>
    <div><label>Shaxsiy chegirma (%)</label><input name="discount_percent" type="number" value="${c.discount_percent || 0}" ${mgr ? '' : 'disabled'}></div></div>
    <label>Izoh</label><input name="note" value="${esc(c.note || '')}" placeholder="masalan: achchiq yemaydi, doim 5-stol">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
  if (!v) return;
  run(async () => { await api('POST', '/api/customers', { ...(id ? { id } : {}), name: v.name, phone: v.phone, birthday: v.birthday, note: v.note, ...(mgr ? { discount_percent: Number(v.discount_percent) || 0 } : {}) }); renderView(); toast('Saqlandi'); });
};
A.custView = (el) => run(async () => {
  const c = await api('GET', `/api/customers/${el.dataset.id}`);
  const v = await modal(`<h2>${esc(c.name || fmtPhone(c.phone))}</h2><p class="muted">${fmtPhone(c.phone)}${c.birthday ? ` · 🎂 ${c.birthday.slice(5).split('-').reverse().join('.')}` : ''}${c.note ? ' · ' + esc(c.note) : ''}</p>
    <div class="grid-stats"><div class="stat"><div class="muted small">Tashriflar</div><div class="v">${c.visits}</div></div><div class="stat"><div class="muted small">Sarflagan</div><div class="v">${money(c.spent)}</div></div>
    <div class="stat"><div class="muted small">Bonus</div><div class="v">${money(c.bonus)}</div></div></div>
    <div class="row" style="align-items:flex-start;gap:12px;flex-wrap:wrap"><div class="grow" style="min-width:260px"><h3>Tashriflar</h3><table class="list">${c.orders.map((o) => `<tr><td>${dt(o.closed_at)}</td><td>${esc(o.table_name || '')} #${o.number}</td><td class="right num">${money(o.total)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>
    <div class="grow" style="min-width:260px"><h3>Bonus harakatlari</h3><table class="list">${c.bonus_moves.map((b) => `<tr><td>${dt(b.at)}</td><td class="muted small">${esc(b.note || '')}</td><td class="right num" style="color:${b.amount < 0 ? 'var(--danger)' : 'var(--accent)'}">${b.amount > 0 ? '+' : ''}${money(b.amount)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div></div>
    <div class="foot">${can('admin', 'menejer') ? '<button class="btn" data-m="val" data-v="bonus">Bonusni o\'zgartirish</button>' : ''}<button class="btn primary" data-m="close">Yopish</button></div>`, { wide: true });
  if (v !== 'bonus') return;
  const b = await modal(`<h2>Bonusni o'zgartirish</h2><label>Summa (+ qo'shish, − ayirish)</label><input name="amount" type="number"><label>Sababi</label><input name="note">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
  if (b) run(async () => { await api('POST', `/api/customers/${c.id}/bonus`, { amount: Number(b.amount), note: b.note }); renderView(); toast('Bonus yangilandi'); });
});

// ---------- XODIMLAR: ish vaqti va maosh ----------
S.staffTab = 'time'; S.staffRange = null;
const monthRange = (off = 0) => { const n = new Date(); const f = new Date(n.getFullYear(), n.getMonth() + off, 1); const t = off ? new Date(n.getFullYear(), n.getMonth() + off + 1, 0) : n; return { from: ymd(f), to: ymd(t) }; };
VIEWS.staff = async function viewStaff(main) {
  S.staffRange ||= { ...monthRange(0), k: 'm0' };
  const r0 = S.staffRange;
  const head = `<div class="row wrap" style="margin-bottom:14px"><div class="sub-tabs" style="margin:0">${[['time', 'Ish vaqti'], ['pay', 'Maosh']].map(([k, n]) => `<button class="btn sm ${S.staffTab === k ? 'primary' : ''}" data-a="sftab" data-v="${k}">${n}</button>`).join('')}</div>
    <div class="grow"></div>${[['d7', '7 kun'], ['m0', 'Shu oy'], ['m1', "O'tgan oy"]].map(([k, n]) => `<button class="btn sm ${r0.k === k ? 'primary' : ''}" data-a="sfrange" data-v="${k}">${n}</button>`).join('')}
    <span class="muted small">${r0.from.split('-').reverse().join('.')} — ${r0.to.split('-').reverse().join('.')}</span></div>`;
  main.innerHTML = head + '<p class="muted">Yuklanmoqda...</p>';
  if (S.staffTab === 'time') {
    const list = await api('GET', `/api/time?from=${r0.from}&to=${r0.to}`).catch(() => []);
    if (S.view !== 'staff') return;
    S.timeList = list;
    const working = list.filter((x) => !x.end_at);
    const dur = (x) => { const ms = (x.end_at ? new Date(x.end_at) : new Date()) - new Date(x.start_at); return `${Math.floor(ms / 36e5)}s ${Math.floor(ms % 36e5 / 6e4)}d`; };
    main.innerHTML = head + `<div class="panel"><h3>Hozir ishda: ${working.length}</h3><div class="row wrap">${working.map((x) => `<span class="chip ok">${esc(x.user_name)} · ${hhmm(x.start_at)} dan</span>`).join('') || '<span class="muted">Hech kim</span>'}</div></div>
      <div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Ish vaqti jurnali</h3><div class="grow"></div><button class="btn" data-a="timeEdit" data-id="">+ Qo'lda qo'shish</button></div>
      <table class="list"><tr><th>Xodim</th><th>Keldi</th><th>Ketdi</th><th class="right">Davomiyligi</th><th>Izoh</th><th></th></tr>
      ${list.map((x) => `<tr><td><b>${esc(x.user_name)}</b> <span class="muted small">${ROLE_NAME[x.role] || ''}</span></td><td>${dt(x.start_at)}</td><td>${x.end_at ? dt(x.end_at) : '<span class="chip ok">ishda</span>'}</td>
        <td class="right num">${dur(x)}</td><td class="muted small">${esc(x.note || '')}</td><td class="right">${can('admin', 'menejer') ? `<button class="btn sm" data-a="timeEdit" data-id="${x.id}">✎</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">—</td></tr>'}</table></div>`;
  } else {
    const [list, pays] = await Promise.all([api('GET', `/api/payroll?from=${r0.from}&to=${r0.to}`), api('GET', `/api/payroll/payments?from=${r0.from}&to=${r0.to}`)]).catch(() => [[], []]);
    if (S.view !== 'staff') return;
    S.payList = list;
    const tot = (k) => list.reduce((s, x) => s + x[k], 0);
    main.innerHTML = head + `<div class="grid-stats"><div class="stat"><div class="muted small">Hisoblangan</div><div class="v">${som(tot('earned'))}</div></div>
      <div class="stat"><div class="muted small">To'langan</div><div class="v">${som(tot('paid'))}</div></div><div class="stat"><div class="muted small">Qoldiq (to'lanishi kerak)</div><div class="v">${som(tot('balance'))}</div></div></div>
      <div class="panel"><h3>Maosh hisob-kitobi</h3><p class="muted small">Stavka va foiz Boshqaruv → Xodimlar bo'limida belgilanadi. Oylik maosh davr kunlariga mutanosib hisoblanadi.</p>
      <table class="list"><tr><th>Xodim</th><th>Turi</th><th class="right">Soat</th><th class="right">Asosiy</th><th class="right">Foiz</th><th class="right">Jami</th><th class="right">To'langan</th><th class="right">Qoldiq</th><th></th></tr>
      ${list.map((u) => `<tr><td><b>${esc(u.name)}</b> <span class="muted small">${ROLE_NAME[u.role] || ''}</span></td>
        <td class="muted small">${{ hourly: `${money(u.rate)}/soat`, monthly: `${money(u.rate)}/oy`, none: 'belgilanmagan' }[u.pay_type] || '—'}${u.percent ? ` + ${u.percent}% ${u.percent_base === 'service' ? 'xizmatdan' : 'sotuvdan'}` : ''}</td>
        <td class="right num">${u.hours}</td><td class="right num">${money(u.base)}</td><td class="right num" title="Baza: ${money(u.percent_base_sum)}">${money(u.percent_sum)}</td>
        <td class="right num"><b>${money(u.earned)}</b></td><td class="right num">${money(u.paid)}</td><td class="right num" style="color:${u.balance > 0 ? 'var(--warn)' : ''}"><b>${money(u.balance)}</b></td>
        <td class="right"><button class="btn sm primary" data-a="payStaff" data-id="${u.id}">To'lash</button></td></tr>`).join('')}</table></div>
      <div class="panel"><h3>To'lovlar</h3><table class="list"><tr><th>Sana</th><th>Xodim</th><th>Turi</th><th class="right">Summa</th><th>Izoh</th><th>Kim berdi</th></tr>
      ${pays.map((p) => `<tr><td>${dt(p.at)}</td><td>${esc(p.user_name)}</td><td><span class="chip ${p.type === 'maosh' ? 'ok' : 'info'}">${p.type === 'maosh' ? 'Maosh' : 'Avans'}</span>${p.from_cash ? ' <span class="muted small">kassadan</span>' : ''}</td>
        <td class="right num">${money(p.amount)}</td><td class="muted small">${esc(p.note || '')}</td><td class="muted">${esc(p.by_name || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">—</td></tr>'}</table></div>`;
  }
};
A.sftab = (el) => { S.staffTab = el.dataset.v; renderView(); };
A.sfrange = (el) => {
  const k = el.dataset.v;
  if (k === 'd7') { const t = new Date(), f = new Date(); f.setDate(f.getDate() - 6); S.staffRange = { from: ymd(f), to: ymd(t), k }; }
  else S.staffRange = { ...monthRange(k === 'm1' ? -1 : 0), k };
  renderView();
};
const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
A.timeEdit = async (el) => {
  const id = Number(el.dataset.id) || null; const x = id ? S.timeList.find((t) => t.id === id) : {};
  const v = await modal(`<h2>${id ? `${esc(x.user_name)} — ish vaqti` : "Ish vaqtini qo'lda qo'shish"}</h2>
    ${id ? '' : `<label>Xodim</label><select name="user_id">${S.boot.users.filter((u) => u.active).map((u) => `<option value="${u.id}">${esc(u.name)} (${ROLE_NAME[u.role]})</option>`).join('')}</select>`}
    <div class="paygrid"><div><label>Keldi</label><input name="start_at" type="datetime-local" value="${localInput(x.start_at)}"></div><div><label>Ketdi</label><input name="end_at" type="datetime-local" value="${localInput(x.end_at)}"></div></div>
    <label>Izoh</label><input name="note" value="${esc(x.note || '')}"><p class="muted small">O'zgarish jurnalga yoziladi.</p>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
  if (!v) return;
  if (!v.start_at) return toast('Kelgan vaqt kiritilmadi', true);
  run(async () => { await api('POST', '/api/time', { ...(id ? { id } : { user_id: Number(v.user_id) }), start_at: new Date(v.start_at).toISOString(), end_at: v.end_at ? new Date(v.end_at).toISOString() : null, note: v.note }); renderView(); toast('Saqlandi'); });
};
A.payStaff = async (el) => {
  const u = S.payList.find((x) => x.id === Number(el.dataset.id));
  const v = await modal(`<h2>${esc(u.name)} — to'lov</h2><p class="muted">Qoldiq: ${som(u.balance)}</p>
    <div class="paygrid"><div><label>Summa</label><input name="amount" type="number" inputmode="numeric" value="${Math.max(0, u.balance)}"></div>
    <div><label>Turi</label><select name="type"><option value="avans">Avans</option><option value="maosh">Maosh</option></select></div></div>
    <label style="display:flex;gap:10px;align-items:center;margin-top:12px;color:var(--text)"><input type="checkbox" name="from_cash" style="width:22px;height:22px" ${S.boot.shift ? 'checked' : ''}> Kassadan naqd berildi (smenadan chiqim)</label>
    <label>Izoh</label><input name="note">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">To'lash</button></div>`);
  if (v) run(async () => { await api('POST', '/api/payroll/pay', { user_id: u.id, amount: Number(v.amount), type: v.type, from_cash: v.from_cash, note: v.note }); renderView(); toast("To'landi"); });
};
