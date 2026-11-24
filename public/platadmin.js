// Dasturxon — 8-etap: platforma admin bo'limlari — statistika, hisob-kitob (akt), nizolar, qaytarishlar, qora ro'yxat va xavf, jurnal.
'use strict';

(() => {
  const { papi, shell, bind, nav, H } = PLATFORM_UI;
  const P = (method, path, body) => papi('ptoken', method, path, body);
  const load = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); return null; } };
  const stat = (name, v, color) => `<div class="stat"><div class="muted small">${name}</div><div class="v"${color ? ` style="color:var(--${color})"` : ''}>${v}</div></div>`;
  const minTxt = (m) => (m == null ? '—' : `${m} daq`);
  const PARTY = { customer: 'Mijoz', restaurant: 'Restoran', courier: 'Kuryer', platform: 'Platforma', none: 'Hech kim' };
  const MEAS = { warn: 'Ogohlantirish', fine: 'Jarima', block: 'Blok', unblock: 'Blokdan chiqarildi' };
  const dChip = (d) => d.appeal_status === 'open' ? '<span class="chip warn">E\'tiroz</span>' : ({ open: '<span class="chip warn">Ochiq</span>', resolved: '<span class="chip ok">Hal qilindi</span>', rejected: '<span class="chip">Rad etildi</span>' })[d.status] || d.status;
  const img = (src, cap) => `<figure><a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt=""></a><figcaption>${cap}</figcaption></figure>`;

  // ---------- Statistika ----------
  let range = '7';
  const rangeQ = () => { const t = new Date(), f = new Date(); if (range === '7') f.setDate(f.getDate() - 6); if (range === '30') f.setDate(f.getDate() - 29); return `from=${ymd(f)}&to=${ymd(t)}`; };
  H.pRange = (el) => { range = el.dataset.v; H.platStats(); };
  H.platStats = async () => {
    const s = await load(() => P('GET', '/api/platform/stats?' + rangeQ())); if (!s) return;
    const t = s.totals, maxG = Math.max(1, ...s.days.map((d) => d.gmv));
    shell('Statistika', nav('platStats'), `<div class="row wrap" style="margin-bottom:14px">${[['today', 'Bugun'], ['7', '7 kun'], ['30', '30 kun']].map(([k, n]) => `<button class="btn sm ${range === k ? 'primary' : ''}" data-p="pRange" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="grid-stats">${stat('Buyurtmalar', t.orders)}${stat('Yetkazildi', t.delivered, 'accent')}${stat('GMV (yetkazilgan)', som(t.gmv))}${stat('Komissiya', som(t.commission), 'accent')}
        ${stat("O'rtacha chek (taom)", som(t.avg_check))}${stat('Kuryerlarga hisoblandi', som(t.courier_pay))}${stat('Kafolat fondi', som(t.fund_balance), t.fund_balance < 0 ? 'danger' : '')}${stat('Qaytarish kutmoqda', som(t.refunds_pending), t.refunds_pending ? 'warn' : '')}
        ${stat('Nizolar', t.disputes)}${stat('Kompensatsiya', som(t.compensation))}${stat('Yangi mijozlar', t.new_customers)}${stat('Rad / olinmadi / bekor', `${t.rejected} / ${t.no_show} / ${t.cancelled}`, 'warn')}</div>
      <div class="panel"><h3>Vaqtlar (o'rtacha)</h3><div class="row wrap" style="gap:28px"><div><div class="muted small">Buyurtmadan yetkazishgacha</div><b>${minTxt(t.avg_total_min)}</b></div>
        <div><div class="muted small">Tayyorlash</div><b>${minTxt(t.avg_prep_min)}</b></div><div><div class="muted small">Tayyor → kuryer oldi</div><b>${minTxt(t.avg_wait_min)}</b></div><div><div class="muted small">Yo'lda</div><b>${minTxt(t.avg_ride_min)}</b></div></div></div>
      <div class="panel"><h3>Kunlar</h3>${s.days.map((d) => `<div class="hbar"><span class="muted small">${d.day.slice(5).split('-').reverse().join('.')}</span><div class="track"><div style="width:${Math.round((d.gmv / maxG) * 100)}%"></div></div><span class="small num">${d.orders} ta · ${money(d.gmv)}</span></div>`).join('') || '<div class="muted">—</div>'}</div>
      <div class="panel"><h3>Bizneslar</h3><table class="list"><tr><th>Biznes</th><th class="right">Buyurtma</th><th class="right">Yetkazildi</th><th class="right">Rad</th><th class="right">GMV</th><th class="right">Komissiya</th><th class="right">O'rt. vaqt</th></tr>
        ${s.businesses.map((b) => `<tr><td>${esc(b.name || '#' + b.id)}</td><td class="right">${b.orders}</td><td class="right">${b.delivered}</td><td class="right">${b.rejected}</td><td class="right num">${money(b.gmv)}</td><td class="right num">${money(b.commission)}</td><td class="right">${minTxt(b.avg_min)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">—</td></tr>'}</table></div>
      <div class="panel"><h3>Kuryerlar samaradorligi</h3><table class="list"><tr><th>Kuryer</th><th class="right">Yetkazdi</th><th class="right">Olinmadi</th><th class="right">Yo'lda</th><th class="right">Biriktirishdan yetkazishgacha</th><th class="right">Reyting</th><th class="right">Rad / voz kechdi</th><th class="right">Ayb (90 k)</th><th class="right">Daromad</th></tr>
        ${s.couriers.map((c) => `<tr><td>${esc(c.name || '#' + c.id)}</td><td class="right">${c.delivered}</td><td class="right">${c.no_show}</td><td class="right">${minTxt(c.avg_ride_min)}</td><td class="right">${minTxt(c.avg_total_min)}</td>
          <td class="right">${c.ratings ? c.rating.toFixed(2) : '—'}</td><td class="right">${c.declines ?? 0} / ${c.releases ?? 0}</td><td class="right" style="${c.strikes ? 'color:var(--warn)' : ''}">${c.strikes}</td><td class="right num">${money(c.earned)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">—</td></tr>'}</table></div>`);
    bind();
  };

  // ---------- Hisob-kitob ----------
  H.platSettle = async () => {
    const d = await load(() => P('GET', '/api/platform/settle')); if (!d) return;
    const due = d.businesses.reduce((s, b) => s + Math.max(0, b.payable), 0), owe = d.businesses.reduce((s, b) => s + Math.max(0, -b.payable), 0);
    const ACT = { open: '<span class="chip warn">To\'lanmagan</span>', paid: '<span class="chip ok">To\'langan</span>', cancelled: '<span class="chip">Bekor</span>' };
    shell('Hisob-kitob', nav('platSettle'), `<div class="grid-stats">${stat('Restoranlarga to\'lanadi (aktsiz)', som(due), 'accent')}${stat('Restoranlar to\'laydi (komissiya)', som(owe), 'warn')}
        ${stat("Ochiq aktlar", som(d.acts.filter((a) => a.status === 'open').reduce((s, a) => s + a.payable, 0)))}${stat('Kuryerlarga qarz', som(d.couriers.reduce((s, c) => s + Math.max(0, c.balance), 0)))}</div>
      <div class="panel"><h3>Restoranlar — hisob-kitob qilinmagan</h3><p class="muted small">Restoran ulushi = taom (+ o'zi yetkazgan bo'lsa yetkazish narxi) − komissiya − restoran o'zi olgan naqd ± tuzatishlar (nizolar). Manfiy — restoran platformaga to'laydi.</p>
        <table class="list"><tr><th>Biznes</th><th class="right">Buyurtma</th><th class="right">Taom</th><th class="right">Komissiya</th><th class="right">Restoran olgan naqd</th><th class="right">Tuzatish</th><th class="right">Yakun</th><th></th></tr>
        ${d.businesses.map((b) => `<tr><td><b>${esc(b.name)}</b><div class="muted small">kod ${esc(b.code)}${b.open_acts.c ? ` · ochiq akt ${money(b.open_acts.s)}` : ''}</div></td><td class="right">${b.orders}</td><td class="right num">${money(b.food)}</td><td class="right num">${money(b.commission)}</td>
          <td class="right num">${money(b.own_cash)}</td><td class="right num">${money(b.adjustments)}</td><td class="right num" style="color:var(--${b.payable >= 0 ? 'accent' : 'warn'})"><b>${money(b.payable)}</b></td>
          <td class="right"><button class="btn sm primary" data-p="mkAct" data-id="${b.id}" data-name="${esc(b.name)}">Akt tuzish</button><button class="btn sm" data-p="bizAdj" data-id="${b.id}" data-name="${esc(b.name)}">±</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Hali yakunlangan yetkazish buyurtmasi yo\'q</td></tr>'}</table></div>
      <div class="panel"><h3>Aktlar</h3><table class="list"><tr><th>#</th><th>Tuzilgan</th><th>Biznes</th><th>Davr oxiri</th><th class="right">Buyurtma</th><th class="right">Summa</th><th>Holat</th><th></th></tr>
        ${d.acts.map((a) => `<tr><td>${a.id}</td><td class="muted">${dt(a.created_at)}</td><td>${esc(a.business_name)}</td><td>${esc(a.date_to)}</td><td class="right">${a.orders}</td><td class="right num"><b>${money(a.payable)}</b></td>
          <td>${ACT[a.status] || a.status}${a.paid_at ? ` <span class="muted small">${dt(a.paid_at)} · ${esc(a.method)}</span>` : ''}</td>
          <td class="right"><button class="btn sm" data-p="actOpen" data-id="${a.id}">Ochish</button>${a.status === 'open' ? `<button class="btn sm primary" data-p="actPaid" data-id="${a.id}" data-sum="${a.payable}">To'landi</button><button class="btn sm danger" data-p="actCancel" data-id="${a.id}">Bekor</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">—</td></tr>'}</table></div>
      <div class="panel"><h3>Kuryerlar hisobi</h3><table class="list"><tr><th>Kuryer</th><th class="right">Hisob</th></tr>${d.couriers.map((c) => `<tr><td>${esc(c.name || '—')} <span class="muted small">${esc(fmtPhone(c.phone))}</span></td><td class="right num" style="color:var(--${c.balance >= 0 ? 'accent' : 'warn'})">${money(c.balance)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">—</td></tr>'}</table>
        <p class="muted small">Musbat — platforma kuryerga to'laydi, manfiy — kuryer naqd topshiradi. To'lov va naqd qabul qilish: <a href="#" data-p="platCouriers">Kuryerlar</a> bo'limida.</p></div>`);
    bind();
  };
  H.mkAct = async (el) => {
    const v = await modal(`<h2>${esc(el.dataset.name)} — akt</h2><label>Qaysi sanagacha yakunlangan buyurtmalar</label><input name="date_to" type="date" value="${ymd(new Date())}">
      <p class="muted small">Shu sanagacha yakunlangan va hali aktga kirmagan barcha buyurtmalar hamda tuzatishlar kiradi.</p><div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Akt tuzish</button></div>`);
    if (!v) return;
    const a = await load(() => P('POST', `/api/platform/settle/${el.dataset.id}`, { date_to: v.date_to })); if (a) { toast(`Akt #${a.id}: ${som(a.payable)}`); H.platSettle(); }
  };
  H.bizAdj = async (el) => {
    const v = await modal(`<h2>${esc(el.dataset.name)} — tuzatish</h2><label>Summa (+ restoranga, − restorandan)</label><input name="amount" type="number" placeholder="-15000"><label>Sabab</label><input name="reason" maxlength="200">
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Qo'shish</button></div>`);
    if (v && (await load(() => P('POST', `/api/platform/businesses/${el.dataset.id}/adjust`, { amount: Number(v.amount), reason: v.reason })))) { toast("Qo'shildi"); H.platSettle(); }
  };
  H.actOpen = async (el) => {
    const a = await load(() => P('GET', `/api/platform/settlements/${el.dataset.id}`)); if (!a) return;
    modal(`<h2>Akt #${a.id} · ${esc(a.business.name)}</h2><div class="muted small">${esc(a.date_to)} gacha · tuzilgan ${dt(a.created_at)}${a.paid_at ? ` · to'langan ${dt(a.paid_at)} (${esc(a.method)})` : ''}</div>
      <table class="list" style="margin-top:10px"><tr><th>Buyurtma</th><th>Holat</th><th class="right">Taom</th><th class="right">Komissiya</th><th class="right">Restoran naqdi</th><th class="right">Ulush</th></tr>
      ${a.lines.map((l) => `<tr><td>D-${l.id} <span class="muted small">${dt(l.at)}</span></td><td>${l.status === 'delivered' ? 'yetkazildi' : 'olinmadi'}</td><td class="right num">${money(l.food)}</td><td class="right num">${money(l.commission)}</td><td class="right num">${money(l.own_cash)}</td><td class="right num">${money(l.net)}</td></tr>`).join('')}
      ${a.adj.map((x) => `<tr><td colspan="5">Tuzatish: ${esc(x.reason)}</td><td class="right num">${money(x.amount)}</td></tr>`).join('')}
      <tr><td colspan="5"><b>Jami ${a.payable >= 0 ? "restoranga to'lanadi" : "restoran to'laydi"}</b></td><td class="right num"><b>${money(a.payable)}</b></td></tr></table>
      <div class="foot"><button class="btn" onclick="window.print()">Chop etish</button><button class="btn primary" data-m="close">Yopish</button></div>`, { wide: true });
  };
  H.actPaid = async (el) => {
    const v = await modal(`<h2>Akt #${el.dataset.id} — to'landi</h2><p>Summa: <b>${som(el.dataset.sum)}</b></p><label>Usul</label><select name="method"><option>o'tkazma</option><option>click</option><option>payme</option><option>naqd</option></select>
      <label>Izoh</label><input name="note" placeholder="To'lov topshirig'i raqami"><div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Tasdiqlash</button></div>`);
    if (v && (await load(() => P('POST', `/api/platform/settlements/${el.dataset.id}/paid`, v)))) { toast('Belgilandi'); H.platSettle(); }
  };
  H.actCancel = async (el) => {
    if (await confirmBox('Aktni bekor qilish', "Buyurtmalar qayta 'hisob-kitob qilinmagan' bo'ladi.", 'Bekor qilish', true) && (await load(() => P('POST', `/api/platform/settlements/${el.dataset.id}/cancel`)))) H.platSettle();
  };

  // ---------- Nizolar ----------
  let dFilter = 'open';
  H.dFilter = (el) => { dFilter = el.dataset.v; H.platDisputes(); };
  H.platDisputes = async () => {
    const list = await load(() => P('GET', '/api/platform/disputes?status=' + dFilter)); if (!list) return;
    shell('Nizolar', nav('platDisputes'), `<div class="row wrap" style="margin-bottom:14px">${[['open', 'Ochiq'], ['closed', 'Yopilgan'], ['all', 'Hammasi']].map(([k, n]) => `<button class="btn sm ${dFilter === k ? 'primary' : ''}" data-p="dFilter" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="panel"><table class="list"><tr><th>#</th><th>Sana</th><th>Kimdan → kimga</th><th>Muammo</th><th>Buyurtma</th><th>Restoran / kuryer</th><th class="right">Da'vo</th><th>Holat</th><th></th></tr>
      ${list.map((d) => `<tr><td>${d.id}</td><td class="muted">${dt(d.created_at)}</td><td>${PARTY[d.opened_by]}${d.against ? ' → ' + PARTY[d.against] : ''}${d.customer_phone ? `<div class="muted small">${esc(fmtPhone(d.customer_phone))}</div>` : ''}${d.risk.map((r) => `<div><span class="chip danger">${esc(r)}</span></div>`).join('')}</td>
        <td><b>${esc(d.category_name)}</b><div class="muted small">${esc(d.text.slice(0, 80))}</div></td><td>${d.order_id ? 'D-' + d.order_id : '—'}</td><td>${esc(d.business_name || '—')}<div class="muted small">${esc(d.courier_name || '')}</div></td>
        <td class="right num">${d.amount ? money(d.amount) : '—'}</td><td>${dChip(d)}${d.guilty ? `<div class="muted small">aybdor: ${PARTY[d.guilty]}</div>` : ''}</td><td class="right"><button class="btn sm primary" data-p="dOpen" data-id="${d.id}">Ko'rib chiqish</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nizo yo\'q</td></tr>'}</table></div>`);
    bind();
  };
  const PH = { seal: 'Plomba (olishda)', door: 'Eshik (mijoz chiqmadi)' };
  H.dOpen = async (el) => {
    const d = await load(() => P('GET', `/api/platform/disputes/${el.dataset.id}`)); if (!d) return;
    const o = d.order, c = d.courier, u = d.customer;
    const photos = [...d.photos.map((p) => img(p.data, `${PH[p.kind] || p.kind} · ${dt(p.at)}${p.lat != null ? ` · <a href="https://yandex.uz/maps/?pt=${p.lng},${p.lat}&z=17" target="_blank" rel="noopener">GPS</a>` : ''}`)),
      ...d.notes.filter((n) => n.photo).map((n) => img(n.photo, `${PARTY[n.author]} · ${dt(n.at)}`))];
    const solve = d.status === 'open', appeal = d.appeal_status === 'open';
    const v = await modal(`<h2>Nizo #${d.id} ${dChip(d)}</h2>
      <div class="note-line"><b>${PARTY[d.opened_by]}${d.against ? ' → ' + PARTY[d.against] : ''}: ${esc(d.category_name)}</b>${d.amount ? ` · da'vo ${som(d.amount)}` : ''}<div>${esc(d.text)}</div></div>
      <div class="row wrap" style="align-items:flex-start;gap:14px;margin-top:10px">
        ${o ? `<div class="grow" style="min-width:260px"><h3 style="margin:6px 0">Buyurtma D-${o.id} · ${esc(d.business?.name || '')}</h3><div class="small">${o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join(', ')}</div>
          <div class="muted small">Jami ${som(o.total)} · to'langan ${som(o.paid_amount)} (${esc(o.payment_status)}) · ${o.own_delivery ? "restoran o'zi yetkazgan" : 'platforma kuryeri'} · kod urinishlari ${o.code_attempts}${o.courier_rating ? ` · baho ⭐${o.courier_rating} ${esc(o.rating_comment || '')}` : ''}</div>
          <div class="muted small">📍 ${esc(o.address)}${o.lat != null ? ` <a href="https://yandex.uz/maps/?pt=${o.lng},${o.lat}&z=17" target="_blank" rel="noopener">xaritada</a>` : ''}</div>
          <ul class="ptl small">${d.timeline.map(([n, t]) => `<li>${esc(n)} <span class="muted">${dt(t)}</span></li>`).join('')}</ul></div>` : ''}
        <div style="min-width:240px">${u ? `<h3 style="margin:6px 0">Mijoz</h3><div class="small">${esc(u.name || '')} ${esc(fmtPhone(u.phone))}</div><div class="muted small">yetkazilgan ${u.completed} · olmagan ${u.no_shows} · asossiz ${u.false_claims} · shikoyatlar ${u.claims}</div>${u.reasons.map((r) => `<span class="chip danger">${esc(r)}</span> `).join('')}` : ''}
          ${c ? `<h3 style="margin:10px 0 6px">Kuryer</h3><div class="small">${esc(c.name)} ${esc(fmtPhone(c.phone))} · ⭐${Number(c.rating).toFixed(2)} · ${c.completed} ta</div><div class="muted small">90 kunda aybdor: ${c.strikes} · taklif: <b>${MEAS[d.suggest_measure]}</b></div>${c.reasons.map((r) => `<span class="chip warn">${esc(r)}</span> `).join('')}` : ''}</div></div>
      ${photos.length ? `<h3 style="margin:12px 0 0">Isbotlar</h3><div class="docs">${photos.join('')}</div>` : ''}
      <h3 style="margin:12px 0 6px">Yozishmalar</h3>${d.notes.filter((n) => n.text).map((n) => `<div class="small"><b>${PARTY[n.author]}</b> <span class="muted">${dt(n.at)}</span> — ${esc(n.text)}</div>`).join('') || '<div class="muted small">—</div>'}
      ${d.status !== 'open' ? `<div class="note-line small" style="margin-top:10px">Qaror: aybdor <b>${PARTY[d.guilty]}</b>${d.compensation ? ` · mijozga ${som(d.compensation)}` : ''}${d.recover ? ` · undirildi ${som(d.recover)}` : ''}${d.measure ? ` · ${MEAS[d.measure]}${d.measure_amount ? ' ' + som(d.measure_amount) : ''}` : ''}</div>` : ''}
      ${appeal ? `<div class="note-line" style="margin-top:10px"><b>E'tiroz (${PARTY[d.guilty]}):</b> ${esc(d.appeal_text)}</div><label>E'tiroz bo'yicha izoh</label><input name="appeal_note">` : ''}
      ${solve ? `<h3 style="margin:14px 0 6px">Qaror</h3><div class="paygrid"><div><label>Aybdor</label><select name="guilty">${['restaurant', 'courier', 'customer', 'platform', 'none'].map((k) => `<option value="${k}" ${k === (d.against || 'none') ? 'selected' : ''}>${PARTY[k]}</option>`).join('')}</select></div>
        <div><label>Mijozga kompensatsiya (fonddan, darhol)</label><input name="compensation" type="number" value="${d.opened_by === 'customer' ? d.amount || 0 : 0}" ${o?.phone ? '' : 'disabled'}></div>
        <div><label>Aybdordan undirish</label><input name="recover" type="number" value="0"></div>
        ${c ? `<div><label>Kuryerga chora</label><select name="measure"><option value="auto">Avtomatik (${MEAS[d.suggest_measure] || '—'})</option><option value="none">Choralarsiz</option><option value="warn">Ogohlantirish</option><option value="fine">Jarima ${money(d.fine)}</option><option value="block">Blok</option>${c?.status === 'blocked' ? '<option value="unblock" ' + (d.category === 'block_appeal' ? 'selected' : '') + '>Blokdan chiqarish</option>' : ''}</select></div>` : ''}</div>
        <label>Qaror izohi (tomonlar ko'radi)</label><input name="note" maxlength="1000">` : ''}
      <label>Ichki izoh / savol</label><input name="text" placeholder="Tomonlarga ko'rinadi">
      <div class="foot" style="flex-wrap:wrap"><button class="btn" data-m="close">Yopish</button><button class="btn" data-m="ok" data-act="note">Izoh qo'shish</button>
        ${appeal ? '<button class="btn danger" data-m="ok" data-act="appeal_no">E\'tirozni rad etish</button><button class="btn primary" data-m="ok" data-act="appeal_yes">E\'tirozni qabul qilish</button>' : ''}
        ${solve ? '<button class="btn primary" data-m="ok" data-act="resolve">Qaror chiqarish</button>' : ''}</div>`, { wide: true });
    if (!v) return;
    let r;
    if (v._act === 'note') r = await load(() => P('POST', `/api/platform/disputes/${d.id}/note`, { text: v.text }));
    if (v._act === 'resolve') r = await load(() => P('POST', `/api/platform/disputes/${d.id}/resolve`, { guilty: v.guilty, compensation: Number(v.compensation) || 0, recover: Number(v.recover) || 0, measure: v.measure, note: v.note }));
    if (v._act?.startsWith('appeal')) r = await load(() => P('POST', `/api/platform/disputes/${d.id}/appeal`, { accept: v._act === 'appeal_yes', note: v.appeal_note }));
    if (r) toast('Saqlandi');
    H.platDisputes();
  };

  // ---------- Qaytarishlar ----------
  const methodSel = `<label>Qanday qaytarildi</label><select name="method"><option>payme</option><option>click</option><option>karta</option><option>o'tkazma</option><option>naqd</option></select><label>Izoh</label><input name="note">`;
  H.platRefunds = async () => {
    const d = await load(() => P('GET', '/api/platform/refunds')); if (!d) return;
    shell('Qaytarishlar', nav('platRefunds'), `<div class="grid-stats">${stat('Bekor/rad etilgan buyurtmalar', som(d.orders.reduce((s, o) => s + o.amount, 0)), 'warn')}${stat('Nizo kompensatsiyalari', som(d.pending.reduce((s, r) => s + r.amount, 0)), 'warn')}</div>
      <div class="panel"><h3>Qaytarilishi kerak — buyurtmalar</h3><p class="muted small">Payme/Click kabinetida to'lovni bekor qiling yoki kartaga o'tkazing, keyin shu yerda belgilang.</p>
        <table class="list"><tr><th>Buyurtma</th><th>Mijoz</th><th>Restoran</th><th>Sabab</th><th>Provayder</th><th class="right">Summa</th><th></th></tr>
        ${d.orders.map((o) => `<tr><td>D-${o.id} <span class="muted small">${dt(o.updated_at)}</span></td><td>${esc(o.name || '')} <span class="muted small">${esc(fmtPhone(o.phone))}</span></td><td>${esc(o.business_name)}</td>
          <td class="small">${o.status === 'rejected' ? 'Rad etildi: ' + esc(o.reject_reason || '') : 'Bekor qilindi'}</td><td>${esc(o.payment_provider)}</td><td class="right num"><b>${money(o.amount)}</b></td><td class="right"><button class="btn sm primary" data-p="refOrder" data-id="${o.id}">Qaytarildi</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Yo\'q</td></tr>'}</table></div>
      <div class="panel"><h3>Nizo kompensatsiyalari</h3><table class="list"><tr><th>#</th><th>Mijoz</th><th>Sabab</th><th class="right">Summa</th><th></th></tr>
        ${d.pending.map((r) => `<tr><td>${r.id}</td><td>${esc(fmtPhone(r.phone))}</td><td>${esc(r.reason)}</td><td class="right num"><b>${money(r.amount)}</b></td><td class="right"><button class="btn sm primary" data-p="refDone" data-id="${r.id}">Qaytarildi</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Yo\'q</td></tr>'}</table></div>
      <details class="panel"><summary><b>Tarix</b></summary><table class="list">${d.done.map((r) => `<tr><td class="muted">${dt(r.done_at)}</td><td>${r.order_id ? 'D-' + r.order_id : ''}</td><td>${esc(fmtPhone(r.phone))}</td><td class="small">${esc(r.reason)}</td><td>${esc(r.method)}</td><td class="right num">${money(r.amount)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></details>`);
    bind();
  };
  H.refOrder = async (el) => { const v = await modal(`<h2>D-${el.dataset.id} — qaytarildi</h2>${methodSel}<div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Tasdiqlash</button></div>`); if (v && (await load(() => P('POST', `/api/platform/refunds/order/${el.dataset.id}`, v)))) H.platRefunds(); };
  H.refDone = async (el) => { const v = await modal(`<h2>Kompensatsiya #${el.dataset.id}</h2>${methodSel}<div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Tasdiqlash</button></div>`); if (v && (await load(() => P('POST', `/api/platform/refunds/${el.dataset.id}/done`, v)))) H.platRefunds(); };

  // ---------- Qora ro'yxat va xavf ----------
  H.platRisk = async () => {
    const [d, lg] = await Promise.all([load(() => P('GET', '/api/platform/risk')), load(() => P('GET', '/api/platform/log'))]); if (!d) return;
    const KIND = { customer: 'Mijoz', courier: 'Kuryer' };
    shell("Qora ro'yxat", nav('platRisk'), `<div class="panel"><h3>Qora ro'yxatga qo'shish</h3><p class="muted small">Barcha restoranlar uchun umumiy. Mijoz ilovaga, kuryer kuryer ilovasiga kira olmaydi (SMS ham yuborilmaydi).</p>
        <div class="row wrap"><input id="bl-phone" placeholder="90 123 45 67" style="max-width:180px"><select id="bl-kind" style="max-width:150px"><option value="customer">Mijoz</option><option value="courier">Kuryer</option></select>
        <input id="bl-reason" placeholder="Sabab" class="grow" style="min-width:200px"><button class="btn danger" data-p="blAdd">Qo'shish</button></div></div>
      <div class="panel"><h3>Qora ro'yxat</h3><table class="list"><tr><th>Telefon</th><th>Turi</th><th>Sabab</th><th>Sana</th><th></th></tr>
        ${d.blacklist.map((b) => `<tr><td>${esc(fmtPhone(b.phone))}</td><td>${KIND[b.kind]}</td><td>${esc(b.reason)}</td><td class="muted">${dt(b.at)}</td><td class="right"><button class="btn sm" data-p="blRemove" data-id="${b.id}">Chiqarish</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Bo\'sh</td></tr>'}</table></div>
      <div class="panel"><h3>Xavfli mijozlar (firibgarlik belgilari)</h3><table class="list"><tr><th>Mijoz</th><th class="right">Yetkazilgan</th><th class="right">Shikoyat</th><th class="right">Kompensatsiya</th><th>Belgilar</th><th></th></tr>
        ${d.customers.map((u) => `<tr><td>${esc(u.name || '')} ${esc(fmtPhone(u.phone))}${u.blocked ? ' <span class="chip danger">bloklangan</span>' : ''}</td><td class="right">${u.completed}</td><td class="right">${u.claims}</td><td class="right num">${money(u.compensation)}</td>
          <td>${u.reasons.map((r) => `<span class="chip ${u.score >= 3 ? 'danger' : 'warn'}">${esc(r)}</span>`).join(' ')}</td><td class="right">${u.blocked ? '' : `<button class="btn sm danger" data-p="blQuick" data-phone="${esc(u.phone)}" data-kind="customer" data-r="${esc(u.reasons.join(', '))}">Bloklash</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Yo\'q</td></tr>'}</table></div>
      <div class="panel"><h3>Xavfli kuryerlar</h3><table class="list"><tr><th>Kuryer</th><th class="right">Yetkazgan</th><th class="right">Olinmadi</th><th class="right">Voz kechdi</th><th>Belgilar</th></tr>
        ${d.couriers.map((c) => `<tr><td>${esc(c.name || '')} ${esc(fmtPhone(c.phone))} <span class="chip ${PLATFORM_UI.CST[c.status]?.[1] || ''}">${PLATFORM_UI.CST[c.status]?.[0] || c.status}</span></td><td class="right">${c.completed}</td><td class="right">${c.no_shows}</td><td class="right">${c.releases}</td>
          <td>${c.reasons.map((r) => `<span class="chip warn">${esc(r)}</span>`).join(' ')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Yo\'q</td></tr>'}</table></div>
      <details class="panel"><summary><b>Platforma jurnali</b></summary><table class="list">${(lg || []).map((x) => `<tr><td class="muted small">${dt(x.at)}</td><td>${esc(x.action)}</td><td class="small">${esc(x.entity || '')} ${x.entity_id ?? ''}</td><td class="small muted">${esc(x.details)}</td></tr>`).join('')}</table></details>`);
    bind();
  };
  H.blAdd = async () => {
    if (await load(() => P('POST', '/api/platform/blacklist', { phone: $('#bl-phone').value, kind: $('#bl-kind').value, reason: $('#bl-reason').value }))) { toast("Qora ro'yxatga qo'shildi"); H.platRisk(); }
  };
  H.blQuick = async (el) => {
    if (!(await confirmBox("Qora ro'yxatga qo'shish", `${fmtPhone(el.dataset.phone)} — ${el.dataset.r}`, 'Bloklash', true))) return;
    if (await load(() => P('POST', '/api/platform/blacklist', { phone: el.dataset.phone, kind: el.dataset.kind, reason: el.dataset.r }))) H.platRisk();
  };
  H.blRemove = async (el) => { if (await load(() => P('POST', `/api/platform/blacklist/${el.dataset.id}/remove`))) H.platRisk(); };
})();
