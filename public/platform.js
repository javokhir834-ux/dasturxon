// Dasturxon — 4-etap: ro'yxatdan o'tish (#register), ega kabineti (#owner), platforma paneli (#platform)
'use strict';

const PLATFORM_UI = (() => {
  const papi = async (tokenKey, method, path, body) => {
    const t = store.get(tokenKey);
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && t) { store.set(tokenKey, null); route(location.hash); throw new Error(j.error || 'Qayta kiring'); }
    if (!r.ok) throw new Error(j.error || 'Xatolik');
    return j;
  };
  const subChip = (s) => {
    if (!s || s.status === 'none') return '';
    const until = s.paid_until ? s.paid_until.split('-').reverse().join('.') : '';
    return ({
      trial: `<span class="chip info">Sinov · ${s.days_left} kun</span>`, active: `<span class="chip ok">Faol · ${until} gacha</span>`,
      grace: `<span class="chip warn">To'lov kutilmoqda · ${s.grace_left} kun</span>`, expired: `<span class="chip danger">Muddati tugagan</span>`,
      blocked: `<span class="chip danger">Bloklangan</span>`, disabled: `<span class="chip">O'chirilgan</span>`,
    })[s.status] || '';
  };
  const shell = (title, right, body) => {
    document.body.classList.add('scroll');
    $('#app').innerHTML = `<div class="shell"><header class="top"><div class="brand"><span class="dot"></span>FastHub</div><span class="muted">${title}</span><div class="grow"></div>${right}</header>
      <div class="page" id="pg">${body}</div></div>`;
  };
  const H = {}; // harakatlar
  const bind = () => { $('#app').onclick = (e) => { const el = e.target.closest('[data-p]'); if (el && H[el.dataset.p]) { e.preventDefault(); H[el.dataset.p](el); } }; };
  const back = '<a class="btn sm" href="#" data-p="toPos">← POS ga</a>';
  // 8-etap: platforma bo'limlari (harakatlari platadmin.js da)
  const NAV = [['platBiz', 'Bizneslar'], ['platCouriers', '🛵 Kuryerlar'], ['platStats', '📊 Statistika'], ['platSettle', '💰 Hisob-kitob'], ['platDisputes', '⚖️ Nizolar'], ['platRefunds', '↩️ Qaytarish'], ['platRisk', "🚫 Qora ro'yxat"], ['platPharm', '💊 Dorixonalar']];
  const nav = (act) => `${back}<nav class="pnav">${NAV.map(([k, n]) => `<button class="btn sm ${k === act ? 'primary' : ''}" data-p="${k}">${n}</button>`).join('')}</nav>`;
  H.toPos = () => { document.body.classList.remove('scroll'); history.replaceState(null, '', location.pathname); boot(); };

  // ---------- Ro'yxatdan o'tish ----------
  function register() {
    shell("Yangi biznes", back, `<div class="page-narrow panel"><h2 style="margin-top:0">Restoraningizni ulang</h2>
      <p class="muted small">14 kun bepul sinov. Karta kerak emas.</p>
      <label>Restoran / kafe nomi</label><input id="r-name" placeholder="masalan: Bahor kafe">
      <label>Ismingiz (ega)</label><input id="r-owner">
      <label>Telefon raqam</label><input id="r-phone" inputmode="tel" placeholder="90 123 45 67">
      <label>Kabinet paroli (kamida 6 belgi)</label><input id="r-pass" type="password">
      <label>Admin PIN (planshetga kirish uchun, 4 raqam)</label><input id="r-pin" inputmode="numeric" maxlength="4">
      <label style="display:flex;gap:10px;align-items:center;margin-top:12px;color:var(--text)"><input id="r-sample" type="checkbox" checked style="width:22px;height:22px"> Namuna menyu bilan boshlash</label>
      <button class="btn primary block" style="margin-top:16px" data-p="doRegister">Ro'yxatdan o'tish</button>
      <p class="muted small" style="text-align:center">Akkauntingiz bormi? <a href="#owner">Ega kabinetiga kiring</a></p></div>`);
    bind();
  }
  H.doRegister = async () => {
    try {
      const r = await papi('', 'POST', '/api/register', { business_name: $('#r-name').value, owner_name: $('#r-owner').value, phone: $('#r-phone').value, password: $('#r-pass').value, admin_pin: $('#r-pin').value, sample: $('#r-sample').checked });
      store.set('bizcode', r.code); store.set('bizname', $('#r-name').value.trim());
      $('#pg').innerHTML = `<div class="page-narrow panel" style="text-align:center"><h2 style="margin-top:0">Tabriklaymiz! 🎉</h2><p>Biznesingiz kodi:</p><div class="bigcode">${esc(r.code)}</div>
        <p class="muted small">Shu kodni yozib qo'ying: planshet va telefonlar shu kod bilan ulanadi. Sinov muddati: ${r.trial_days} kun.</p>
        <p class="muted small">Ofitsiant, kassir va oshpazlarni POS → Boshqaruv → Xodimlar bo'limida qo'shasiz. Bir nechta filial — ega kabinetida.</p>
        <button class="btn primary block" data-p="toPos">POS ni ochish (PIN bilan kirish)</button></div>`;
    } catch (e) { toast(e.message, true); }
  };

  // ---------- Ega kabineti ----------
  let oRange = 'today';
  const rangeOf = (k) => { const t = new Date(), f = new Date(); if (k === '7') f.setDate(f.getDate() - 6); if (k === 'month') f.setDate(1); return `from=${ymd(f)}&to=${ymd(t)}`; };
  async function owner() {
    if (!store.get('otoken')) {
      shell('Ega kabineti', back, `<div class="page-narrow panel"><h2 style="margin-top:0">Ega kabineti</h2><p class="muted small">Barcha filiallaringiz bir joyda: tushum, smenalar, obuna.</p>
        <label>Telefon raqam</label><input id="o-phone" inputmode="tel" placeholder="90 123 45 67"><label>Parol</label><input id="o-pass" type="password">
        <button class="btn primary block" style="margin-top:16px" data-p="ownerLogin">Kirish</button>
        <p class="muted small" style="text-align:center">Hali ro'yxatdan o'tmaganmisiz? <a href="#register">Yangi biznes ochish</a></p></div>`);
      bind(); $('#o-pass').onkeydown = (e) => e.key === 'Enter' && H.ownerLogin();
      return;
    }
    let d;
    try { d = await papi('otoken', 'GET', '/api/owner/me?' + rangeOf(oRange)); } catch (e) { return toast(e.message, true); }
    const sum = (k) => d.branches.reduce((s, b) => s + b[k], 0);
    shell(`Ega kabineti · ${esc(d.owner.name)}`, `${back}<button class="btn sm" data-p="ownerPass">Parol</button><button class="btn sm" data-p="ownerLogout">Chiqish</button>`, `
      <div class="row wrap" style="margin-bottom:14px">${[['today', 'Bugun'], ['7', '7 kun'], ['month', 'Shu oy']].map(([k, n]) => `<button class="btn sm ${oRange === k ? 'primary' : ''}" data-p="oRange" data-v="${k}">${n}</button>`).join('')}
        <div class="grow"></div><button class="btn primary" data-p="newBranch">+ Filial qo'shish</button></div>
      <div class="grid-stats"><div class="stat"><div class="muted small">Jami tushum</div><div class="v">${som(sum('revenue'))}</div></div>
        <div class="stat"><div class="muted small">Buyurtmalar</div><div class="v">${sum('orders')}</div></div>
        <div class="stat"><div class="muted small">Hozir ochiq buyurtmalar</div><div class="v">${sum('open_orders')}</div></div>
        <div class="stat"><div class="muted small">Filiallar</div><div class="v">${d.branches.length}</div></div></div>
      <div class="card-grid">${d.branches.map((b) => `<div class="panel" style="margin:0">
        <div class="row"><h3 style="margin:0">${esc(b.name)}</h3><div class="grow"></div>${b.shift_open ? `<span class="chip ok">Smena ochiq · ${hhmm(b.shift_open)}</span>` : '<span class="chip">Smena yopiq</span>'}</div>
        <div class="muted small" style="margin:4px 0 10px">${b.address ? esc(b.address) + ' · ' : ''}kod <b>${esc(b.code)}</b></div>
        <div class="row wrap" style="gap:18px"><div><div class="muted small">Tushum</div><b class="num">${som(b.revenue)}</b></div><div><div class="muted small">Buyurtma</div><b>${b.orders}</b></div>
          <div><div class="muted small">O'rt. chek</div><b class="num">${money(b.avg)}</b></div><div><div class="muted small">Ochiq</div><b>${b.open_orders}</b></div></div>
        ${b.mirror ? `<div class="muted small" style="margin-top:8px">🔄 Lokal server · oxirgi sinxron ${b.last_sync_at ? dt(b.last_sync_at) : '—'}</div>` : ''}
        <div class="row wrap" style="margin-top:12px;gap:6px"><span class="muted small">POS:</span>${subChip(b.pos)}<span class="muted small">Yetkazib berish:</span>${subChip(b.delivery)}</div>
        <div class="row wrap" style="margin-top:12px;gap:6px"><button class="btn sm primary" data-p="openBranch" data-code="${esc(b.code)}" data-name="${esc(b.name)}">Shu qurilmada ochish</button>
          <button class="btn sm" data-p="branchPin" data-id="${b.id}" data-name="${esc(b.name)}">Admin PIN tiklash</button><button class="btn sm" data-p="syncKey" data-id="${b.id}" data-name="${esc(b.name)}">Lokal serverni ulash</button><button class="btn sm" data-p="branchEdit" data-id="${b.id}">✎</button></div></div>`).join('')}</div>
      <div class="panel" style="margin-top:14px"><h3>Obuna</h3><p class="muted">Har bir filial uchun alohida: <b>POS — ${som(d.prices.pos)}/oy</b>, <b>Yetkazib berish — ${som(d.prices.delivery)}/oy</b> (yetkazib berish ilovasi ishga tushganda).</p>
        <p class="muted small">Hozircha to'lov platforma administratori orqali qabul qilinadi (Click/Payme/naqd). Onlayn to'lov keyingi bosqichda qo'shiladi.</p></div>`);
    S.ownerData = d; bind();
  }
  H.ownerLogin = async () => {
    try { const r = await papi('', 'POST', '/api/owner/login', { phone: $('#o-phone').value, password: $('#o-pass').value }); store.set('otoken', r.token); owner(); }
    catch (e) { toast(e.message, true); }
  };
  H.ownerLogout = async () => { await papi('otoken', 'POST', '/api/owner/logout').catch(() => {}); store.set('otoken', null); owner(); };
  H.oRange = (el) => { oRange = el.dataset.v; owner(); };
  H.openBranch = (el) => {
    if (S.user && store.get('bizcode') !== el.dataset.code) { logout(); }
    store.set('bizcode', el.dataset.code); store.set('bizname', el.dataset.name); H.toPos();
  };
  H.newBranch = async () => {
    const d = S.ownerData;
    const v = await modal(`<h2>Yangi filial</h2><label>Filial nomi</label><input name="name"><label>Manzil</label><input name="address">
      <label>Menyu va sozlamalar</label><select name="copy_from">${d.branches.map((b) => `<option value="${b.id}">"${esc(b.name)}" dan nusxa olish</option>`).join('')}<option value="sample">Namuna menyu</option><option value="">Bo'sh</option></select>
      <div class="paygrid"><div><label>Admin ismi</label><input name="admin_name" value="Admin"></div><div><label>Admin PIN (4 raqam)</label><input name="admin_pin" inputmode="numeric" maxlength="4"></div></div>
      <p class="muted small">Nusxada zal, stollar, menyu, texkartalar va masalliqlar ko'chiriladi (qoldiq, buyurtma va xodimlar ko'chmaydi). Yangi filialga 14 kun sinov beriladi.</p>
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Yaratish</button></div>`);
    if (!v) return;
    try {
      const r = await papi('otoken', 'POST', '/api/owner/branches', { name: v.name, address: v.address, admin_name: v.admin_name, admin_pin: v.admin_pin,
        copy_from: Number(v.copy_from) || null, sample: v.copy_from === 'sample' });
      await owner(); modal(`<h2>Filial yaratildi</h2><p>Filial kodi:</p><div class="bigcode">${esc(r.code)}</div><p class="muted small">Filialdagi planshetlarda shu kodni kiriting.</p><div class="foot"><button class="btn primary" data-m="close">Yopish</button></div>`);
    } catch (e) { toast(e.message, true); }
  };
  H.branchPin = async (el) => {
    const pin = await ask(`${el.dataset.name} — admin PIN`, 'Yangi 4 xonali PIN', { type: 'text' });
    if (!pin) return;
    try { await papi('otoken', 'POST', `/api/owner/branches/${el.dataset.id}/admin-pin`, { pin }); toast('Admin PIN yangilandi'); } catch (e) { toast(e.message, true); }
  };
  H.syncKey = async (el) => {
    if (!(await confirmBox('Lokal serverni ulash', `"${el.dataset.name}" uchun yangi ulash kaliti yaratiladi (eski kalit bekor bo'ladi). Ulangandan keyin bu filialning bulutdagi ma'lumotlari restorandagi kompyuter ma'lumotlari bilan almashtiriladi.`, 'Kalit yaratish'))) return;
    try {
      const r = await papi('otoken', 'POST', `/api/owner/branches/${el.dataset.id}/sync-key`);
      modal(`<h2>Ulash kaliti</h2><p class="muted small">Restorandagi kompyuterda: POS → Boshqaruv → Sozlamalar → Bulut sinxronizatsiya. Kalit faqat hozir ko'rsatiladi.</p>
        <label>Bulut manzili</label><input readonly value="${esc(location.origin)}"><label>Ulash kaliti</label><input readonly value="${esc(r.key)}" style="font-family:monospace">
        <div class="foot"><button class="btn primary" data-m="close">Yopish</button></div>`);
    } catch (e) { toast(e.message, true); }
  };
  H.branchEdit = async (el) => {
    const b = S.ownerData.branches.find((x) => x.id === Number(el.dataset.id));
    const v = await modal(`<h2>Filialni tahrirlash</h2><label>Nomi</label><input name="name" value="${esc(b.name)}"><label>Manzil</label><input name="address" value="${esc(b.address || '')}">
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
    if (v) try { await papi('otoken', 'POST', `/api/owner/branches/${b.id}`, v); owner(); } catch (e) { toast(e.message, true); }
  };
  H.ownerPass = async () => {
    const v = await modal(`<h2>Parolni o'zgartirish</h2><label>Eski parol</label><input name="old_password" type="password"><label>Yangi parol</label><input name="new_password" type="password">
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
    if (v) try { await papi('otoken', 'POST', '/api/owner/password', v); toast("Parol o'zgartirildi"); } catch (e) { toast(e.message, true); }
  };

  // ---------- Platforma paneli ----------
  async function platform() {
    if (!store.get('ptoken')) {
      shell('Platforma', back, `<div class="page-narrow panel"><h2 style="margin-top:0">Platforma paneli</h2><label>Parol</label><input id="p-pass" type="password">
        <button class="btn primary block" style="margin-top:16px" data-p="platLogin">Kirish</button></div>`);
      bind(); $('#p-pass').onkeydown = (e) => e.key === 'Enter' && H.platLogin();
      return;
    }
    let list, pays, st;
    try { [list, pays, st] = await Promise.all([papi('ptoken', 'GET', '/api/platform/businesses'), papi('ptoken', 'GET', '/api/platform/payments'), papi('ptoken', 'GET', '/api/platform/settings')]); }
    catch (e) { return toast(e.message, true); }
    const cnt = (s) => list.filter((b) => b.pos.status === s).length;
    const month = ymd(new Date()).slice(0, 7);
    shell('Platforma paneli', `${nav('platBiz')}<button class="btn sm" data-p="platSettings">Sozlamalar</button><button class="btn sm" data-p="platLogout">Chiqish</button>`, `
      <div class="grid-stats"><div class="stat"><div class="muted small">Bizneslar</div><div class="v">${list.length}</div></div>
        <div class="stat"><div class="muted small">To'lagan (faol)</div><div class="v" style="color:var(--accent)">${cnt('active')}</div></div>
        <div class="stat"><div class="muted small">Sinovda</div><div class="v">${cnt('trial')}</div></div>
        <div class="stat"><div class="muted small">Kutilmoqda / tugagan</div><div class="v" style="color:var(--warn)">${cnt('grace') + cnt('expired')}</div></div>
        <div class="stat"><div class="muted small">Shu oy daromad</div><div class="v">${som(pays.byMonth.find((m) => m.month === month)?.sum || 0)}</div></div>
        <div class="stat"><div class="muted small">Jami daromad</div><div class="v">${som(pays.byMonth.reduce((s, m) => s + m.sum, 0))}</div></div></div>
      <div class="panel"><h3>Bizneslar</h3><table class="list"><tr><th>Biznes</th><th>Ega</th><th>POS</th><th>Yetkazib berish</th><th class="right">30 kun buyurtma</th><th class="right">Bugun tushum</th><th class="right">To'lagan</th><th></th></tr>
      ${list.map((b) => `<tr><td><b>${esc(b.name)}</b><div class="muted small">kod ${esc(b.code)}${b.address ? ' · ' + esc(b.address) : ''}</div></td>
        <td>${esc(b.owner_name || '—')}<div class="muted small">${esc(fmtPhone(b.owner_phone || ''))}</div></td><td>${subChip(b.pos)}</td><td>${subChip(b.delivery)}</td>
        <td class="right">${b.orders_30d}</td><td class="right num">${money(b.revenue_today)}</td><td class="right num">${money(b.paid_total)}</td>
        <td class="right"><button class="btn sm primary" data-p="extend" data-id="${b.id}">Uzaytirish</button><button class="btn sm" data-p="subEdit" data-id="${b.id}">✎</button>
          <button class="btn sm ${b.pos.status === 'blocked' ? '' : 'danger'}" data-p="block" data-id="${b.id}" data-v="${b.pos.status === 'blocked' ? 0 : 1}">${b.pos.status === 'blocked' ? 'Ochish' : 'Bloklash'}</button></td></tr>`).join('')}</table></div>
      <div class="row wrap" style="align-items:flex-start"><div class="panel grow" style="min-width:320px"><h3>To'lovlar</h3><table class="list"><tr><th>Sana</th><th>Biznes</th><th>Xizmat</th><th class="right">Oy</th><th class="right">Summa</th><th>Usul</th></tr>
        ${pays.list.map((p) => `<tr><td>${dt(p.at)}</td><td>${esc(p.business_name)}</td><td>${p.product === 'pos' ? 'POS' : 'Yetkazib berish'}</td><td class="right">${p.months}</td><td class="right num">${money(p.amount)}</td><td class="muted">${esc(p.method || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">—</td></tr>'}</table></div>
      <div class="panel" style="min-width:260px"><h3>Oylar bo'yicha</h3><table class="list">${pays.byMonth.map((m) => `<tr><td>${m.month}</td><td class="right num">${money(m.sum)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table>
        <p class="muted small">Narxlar: POS ${money(st.price_pos)}, yetkazib berish ${money(st.price_delivery)} · sinov ${st.trial_days} kun · imtiyoz ${st.grace_days} kun</p></div></div>`);
    S.platData = { list, st }; bind();
  }
  H.platLogin = async () => { try { const r = await papi('', 'POST', '/api/platform/login', { password: $('#p-pass').value }); store.set('ptoken', r.token); platform(); } catch (e) { toast(e.message, true); } };
  H.platLogout = () => { store.set('ptoken', null); platform(); };
  const bizOf = (el) => S.platData.list.find((b) => b.id === Number(el.dataset.id));
  H.extend = async (el) => {
    const b = bizOf(el); const st = S.platData.st;
    const v = await modal(`<h2>${esc(b.name)} — obunani uzaytirish</h2>
      <div class="paygrid"><div><label>Xizmat</label><select name="product"><option value="pos">POS</option><option value="delivery">Yetkazib berish</option></select></div>
      <div><label>Necha oy</label><input name="months" type="number" value="1" min="1"></div>
      <div><label>Summa (bo'sh — narx × oy)</label><input name="amount" type="number" inputmode="numeric" placeholder="${st.price_pos}"></div>
      <div><label>To'lov usuli</label><select name="method"><option>click</option><option>payme</option><option>naqd</option><option>o'tkazma</option></select></div></div>
      <label>Izoh</label><input name="note"><p class="muted small">Muddat o'tib ketgan bo'lsa — bugundan, aks holda joriy muddat oxiridan uzaytiriladi.</p>
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">To'lovni qayd etish</button></div>`);
    if (!v) return;
    try { await papi('ptoken', 'POST', `/api/platform/businesses/${b.id}/extend`, { product: v.product, months: Number(v.months), method: v.method, note: v.note, ...(v.amount ? { amount: Number(v.amount) } : {}) }); platform(); toast('Uzaytirildi'); }
    catch (e) { toast(e.message, true); }
  };
  H.subEdit = async (el) => {
    const b = bizOf(el);
    const v = await modal(`<h2>${esc(b.name)} — obuna</h2><label>POS amal qilish muddati</label><input name="pos_until" type="date" value="${b.pos.paid_until || ''}">
      <label>Yetkazib berish muddati</label><input name="del_until" type="date" value="${b.delivery.paid_until || ''}">
      <label style="display:flex;gap:10px;align-items:center;margin-top:12px;color:var(--text)"><input type="checkbox" name="del_enabled" style="width:22px;height:22px" ${b.delivery.status !== 'disabled' ? 'checked' : ''}> Yetkazib berish xizmati yoqilgan</label>
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
    if (!v) return;
    try {
      await papi('ptoken', 'POST', `/api/platform/businesses/${b.id}/subscription`, { product: 'pos', paid_until: v.pos_until });
      await papi('ptoken', 'POST', `/api/platform/businesses/${b.id}/subscription`, { product: 'delivery', paid_until: v.del_until, enabled: v.del_enabled });
      platform();
    } catch (e) { toast(e.message, true); }
  };
  H.block = async (el) => {
    const b = bizOf(el); const on = el.dataset.v === '1';
    if (on && !(await confirmBox('Biznesni bloklash', `"${b.name}" xodimlari tizimdan chiqariladi va kira olmaydi.`, 'Bloklash', true))) return;
    try { await papi('ptoken', 'POST', `/api/platform/businesses/${b.id}/subscription`, { product: 'pos', blocked: on }); platform(); } catch (e) { toast(e.message, true); }
  };
  H.platSettings = async () => {
    const st = S.platData.st;
    const v = await modal(`<h2>Platforma sozlamalari</h2><div class="paygrid"><div><label>POS narxi (oyiga)</label><input name="price_pos" type="number" value="${st.price_pos}"></div>
      <div><label>Yetkazib berish narxi</label><input name="price_delivery" type="number" value="${st.price_delivery}"></div>
      <div><label>Sinov muddati (kun)</label><input name="trial_days" type="number" value="${st.trial_days}"></div><div><label>Imtiyozli davr (kun)</label><input name="grace_days" type="number" value="${st.grace_days}"></div>
      <div><label>Yetkazish komissiyasi (%)</label><input name="commission_percent" type="number" value="${st.commission_percent ?? 12}"></div>
      <div><label>Kafolat fondi (taom summasidan %)</label><input name="fund_percent" type="number" value="${st.fund_percent ?? 1}"></div>
      <div><label>Kuryer minimal haqi (so'm)</label><input name="courier_min_fee" type="number" value="${st.courier_min_fee ?? 8000}"></div>
      <div><label>Taklifga javob vaqti (soniya)</label><input name="offer_seconds" type="number" value="${st.offer_seconds ?? 30}"></div>
      <div><label>Kuryer qidirish radiusi (km)</label><input name="dispatch_radius_km" type="number" value="${st.dispatch_radius_km ?? 7}"></div>
      <div><label>Sinov davri (buyurtma)</label><input name="probation_orders" type="number" value="${st.probation_orders ?? 20}"></div>
      <div><label class="chk"><input type="checkbox" name="pharmacy_enabled" ${String(st.pharmacy_enabled) === '1' ? 'checked' : ''}> Dorixonalar yoqilgan (yurist xulosasidan keyin)</label></div>
      <div><label>Shikoyat muddati (kun)</label><input name="dispute_days" type="number" value="${st.dispute_days ?? 2}"></div>
      <div><label>E'tiroz muddati (kun)</label><input name="appeal_days" type="number" value="${st.appeal_days ?? 3}"></div>
      <div><label>Kuryer jarimasi (2-ayb, so'm)</label><input name="dispute_fine" type="number" value="${st.dispute_fine ?? 20000}"></div></div>
      <p class="muted small">Komissiya taom summasidan olinadi va yangi buyurtmalarga qo'llanadi.</p>
      <label>Yangi parol (o'zgartirmaslik uchun bo'sh)</label><input name="new_password" type="password">
      <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
    if (!v) return;
    try { await papi('ptoken', 'POST', '/api/platform/settings', { price_pos: Number(v.price_pos), price_delivery: Number(v.price_delivery), trial_days: Number(v.trial_days), grace_days: Number(v.grace_days), commission_percent: Number(v.commission_percent),
      ...Object.fromEntries(['fund_percent', 'courier_min_fee', 'offer_seconds', 'dispatch_radius_km', 'probation_orders', 'dispute_days', 'appeal_days', 'dispute_fine'].map((k) => [k, Number(v[k])])), pharmacy_enabled: v.pharmacy_enabled ? 1 : 0, ...(v.new_password ? { new_password: v.new_password } : {}) }); platform(); toast('Saqlandi'); }
    catch (e) { toast(e.message, true); }
  };

  // ---------- Kuryerlar (7-etap) ----------
  const CST = { draft: ['Qoralama', ''], pending: ['Tekshiruvda', 'warn'], probation: ['Sinov davri', 'info'], active: ['Faol', 'ok'], blocked: ['Bloklangan', 'danger'], rejected: ['Rad etilgan', 'danger'] };
  const VEHN = { piyoda: 'Piyoda', velosiped: 'Velosiped', moto: 'Moto', avto: 'Avto' };
  const DOCN = { passport: 'Pasport', selfie: 'Selfi', license: 'Guvohnoma', vehicle: 'Transport' };
  H.platBiz = () => platform();
  // ---------- 9-etap: dorixonalar (litsenziya tekshiruvi) ----------
  H.platPharm = async () => {
    let list, st;
    try { [list, st] = await Promise.all([papi('ptoken', 'GET', '/api/platform/pharmacies'), papi('ptoken', 'GET', '/api/platform/settings')]); } catch (e) { return toast(e.message, true); }
    shell('Dorixonalar', nav('platPharm'), `${String(st.pharmacy_enabled) !== '1' ? '<div class="banner warn">Dorixona toifasi o\'chiq — yurist xulosasidan keyin Sozlamalar → "Dorixonalar yoqilgan".</div>' : ''}
      <div class="panel"><h3>Dorixonalar</h3><p class="muted small">Ilovada faqat retseptsiz dorilar. Litsenziya raqamini davlat reestrida tekshirib, tasdiqlang.</p>
      <table class="list"><tr><th>Dorixona</th><th>Litsenziya</th><th>Muddati</th><th>Holat</th><th></th></tr>
      ${list.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="muted small">kod ${esc(x.code)}</div></td><td>${esc(x.license_no || '—')}</td><td>${esc(x.license_until || '—')}</td>
        <td>${x.visible ? '<span class="chip ok">Ilovada</span>' : `<span class="chip warn">${esc(x.reason)}</span>`}${x.verified ? ' <span class="chip info">tasdiqlangan</span>' : ''}</td>
        <td class="right">${x.verified ? `<button class="btn sm" data-p="pharmSet" data-id="${x.id}" data-v="0">Bekor qilish</button>` : `<button class="btn sm primary" data-p="pharmSet" data-id="${x.id}" data-v="1" ${x.license_no ? '' : 'disabled'}>Tasdiqlash</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Hali dorixona yo\'q</td></tr>'}</table></div>`);
    bind();
  };
  H.pharmSet = async (el) => {
    const note = el.dataset.v === '1' ? prompt("Izoh (masalan: reestrda tekshirildi)") : prompt('Bekor qilish sababi');
    if (note == null) return;
    try { await papi('ptoken', 'POST', `/api/platform/pharmacies/${el.dataset.id}`, { verified: el.dataset.v === '1', note }); toast('Saqlandi'); } catch (e) { return toast(e.message, true); }
    H.platPharm();
  };
  H.platCouriers = async () => {
    let list, fund;
    try { [list, fund] = await Promise.all([papi('ptoken', 'GET', '/api/platform/couriers'), papi('ptoken', 'GET', '/api/platform/fund')]); } catch (e) { return toast(e.message, true); }
    const n = (f) => list.filter(f).length;
    shell('Kuryerlar', nav('platCouriers'), `
      <div class="grid-stats"><div class="stat"><div class="muted small">Tekshiruvda</div><div class="v" style="color:var(--warn)">${n((c) => c.status === 'pending')}</div></div>
        <div class="stat"><div class="muted small">Ishlayotgan</div><div class="v">${n((c) => ['probation', 'active'].includes(c.status))}</div></div>
        <div class="stat"><div class="muted small">Hozir liniyada</div><div class="v" style="color:var(--accent)">${n((c) => c.online)}</div></div>
        <div class="stat"><div class="muted small">Kuryerlardagi naqd</div><div class="v">${som(list.reduce((t, c) => t + c.hand, 0))}</div></div>
        <div class="stat"><div class="muted small">Kafolat fondi</div><div class="v">${som(fund.balance)}</div></div></div>
      <div class="panel"><h3>Kuryerlar</h3><table class="list"><tr><th>Kuryer</th><th>Holat</th><th>Transport</th><th class="right">Reyting</th><th class="right">Yetkazgan</th><th class="right">Qo'lidagi naqd</th><th class="right">Hisob</th><th></th></tr>
      ${list.map((c) => `<tr><td><b>${esc(c.name || '—')}</b>${c.online ? ' <span class="chip ok">liniyada</span>' : ''}${c.busy ? ' <span class="chip info">buyurtmada</span>' : ''}<div class="muted small">${esc(fmtPhone(c.phone))} · ${esc(c.level)}</div></td>
        <td><span class="chip ${CST[c.status]?.[1] || ''}">${CST[c.status]?.[0] || c.status}</span>${c.mustSettle ? ' <span class="chip danger">naqd topshirmagan</span>' : ''}${c.rating_warn ? ' <span class="chip warn">reyting past</span>' : ''}</td>
        <td>${VEHN[c.vehicle] || '—'} ${esc(c.vehicle_no || '')}</td><td class="right">${c.ratings ? c.rating.toFixed(2) + ` <span class="muted small">(${c.ratings})</span>` : '—'}</td><td class="right">${c.completed}</td>
        <td class="right num" style="${c.hand ? 'color:var(--warn)' : ''}">${money(c.hand)}</td><td class="right num">${money(c.balance)}</td>
        <td class="right"><button class="btn sm ${c.status === 'pending' ? 'primary' : ''}" data-p="courierOpen" data-id="${c.id}">Ochish</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Hali kuryer yo\'q. Kuryer ilovasi: /courier</td></tr>'}</table>
        <p class="muted small">Hisob: musbat — platforma kuryerga qarzdor, manfiy — kuryer topshirishi kerak. Kuryer ilovasi manzili: <b>${location.origin}/courier</b></p></div>`);
    bind();
  };
  H.courierOpen = async (el) => {
    let c; try { c = await papi('ptoken', 'GET', `/api/platform/couriers/${el.dataset.id}`); } catch (e) { return toast(e.message, true); }
    const TN = { fee: 'Haqi', bonus: 'Bonus', cash: 'Naqd oldi', cash_in: 'Naqd topshirdi', payout: "To'landi", penalty: 'Jarima', deposit: 'Depozit', note: 'Izoh' };
    const v = await modal(`<h2>${esc(c.name || 'Kuryer')} <span class="chip ${CST[c.status]?.[1] || ''}">${CST[c.status]?.[0]}</span></h2>
      <div class="muted small">${esc(fmtPhone(c.phone))} · ${VEHN[c.vehicle] || '—'} ${esc(c.vehicle_no || '')} · test ${c.test_score ?? '—'}/8 · ${esc(c.level)} · depozit ${money(c.deposit)} · naqd limit ${money(c.cash_limit)}</div>
      ${c.status_reason ? `<div class="note-line muted small">Sabab: ${esc(c.status_reason)}</div>` : ''}
      <div class="docs">${c.docs.map((d) => `<figure><img src="${esc(d.data)}" alt=""><figcaption>${DOCN[d.kind] || d.kind}</figcaption></figure>`).join('') || '<span class="muted">Hujjat yo\'q</span>'}</div>
      <label class="chk"><input type="checkbox" name="myid" ${c.myid_verified ? 'checked' : ''}> MyID orqali shaxsi tasdiqlangan</label>
      <div class="muted small">Yetkazgan ${c.completed} · mijoz olmagan ${c.no_shows} · rad etgan ${c.declines} · voz kechgan ${c.releases} · qo'lidagi naqd <b>${money(c.hand)}</b> · hisob <b>${money(c.balance)}</b></div>
      <h3 style="margin:14px 0 6px">Pul harakati</h3><div class="paygrid"><div><select name="mtype"><option value="">— tanlang —</option><option value="cash_in">Naqd qabul qilindi (kunlik hisob)</option><option value="payout">Kuryerga to'landi</option>
        <option value="deposit">Depozit qabul qilindi</option><option value="deposit_return">Depozit qaytarildi</option><option value="bonus">Bonus</option><option value="penalty">Jarima</option></select></div>
        <div><input name="amount" type="number" placeholder="Summa"></div></div><input name="note" placeholder="Izoh" style="margin-top:8px">
      <label>Holat sababi (rad etish / bloklash uchun)</label><input name="reason">
      <div class="foot" style="flex-wrap:wrap">${c.status === 'pending' ? '<button class="btn primary" data-m="ok" data-act="approve">Tasdiqlash</button><button class="btn danger" data-m="ok" data-act="reject">Rad etish</button>' : ''}
        ${['probation', 'active'].includes(c.status) ? '<button class="btn danger" data-m="ok" data-act="block">Bloklash</button>' : ''}${c.status === 'blocked' ? '<button class="btn" data-m="ok" data-act="unblock">Blokdan chiqarish</button>' : ''}
        <button class="btn" data-m="close">Yopish</button><button class="btn primary" data-m="ok" data-act="save">Saqlash</button></div>
      <details style="margin-top:10px"><summary class="muted small">Oxirgi harakatlar</summary><table class="list">${c.moves.map((m) => `<tr><td class="muted small">${dt(m.at)}</td><td>${TN[m.type] || m.type}${m.order_id ? ' #' + m.order_id : ''}</td><td class="small muted">${esc(m.note)}</td><td class="right num">${money(m.amount)}</td></tr>`).join('')}</table></details>`, { wide: true });
    if (!v) return;
    try {
      if (!!v.myid !== c.myid_verified) await papi('ptoken', 'POST', `/api/platform/couriers/${c.id}/myid`, { verified: v.myid });
      if (v.mtype && Number(v.amount) > 0) await papi('ptoken', 'POST', `/api/platform/couriers/${c.id}/money`, { type: v.mtype, amount: Number(v.amount), note: v.note });
      if (v._act && v._act !== 'save') await papi('ptoken', 'POST', `/api/platform/couriers/${c.id}/status`, { action: v._act, reason: v.reason });
      toast('Saqlandi');
    } catch (e) { toast(e.message, true); }
    H.platCouriers();
  };

  function route(hash) {
    if (hash === '#register') return register();
    if (hash === '#owner') return owner();
    if (hash === '#platform') return platform();
  }
  return { route, papi, shell, bind, nav, H, CST };
})();
