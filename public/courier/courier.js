// Dasturxon — kuryer ilovasi (7-etap): ro'yxat, liniya, takliflar, buyurtmani olish va topshirish, hisob.
'use strict';
(() => {
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const som = (n) => money(n) + " so'm";
const dt = (iso) => { if (!iso) return ''; const d = new Date(iso), z = (n) => String(n).padStart(2, '0'); return `${z(d.getDate())}.${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const fmtPhone = (p) => (p && p.length === 12 ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : p || '');
const kmTxt = (k) => (k == null ? '' : k < 1 ? `${Math.round(k * 1000)} m` : `${k.toFixed(1)} km`);
const mapUrl = (lat, lng) => (lat != null ? `https://yandex.uz/maps/?rtext=~${lat},${lng}&rtt=auto` : '');
const VEH = [['piyoda', 'Piyoda'], ['velosiped', 'Velosiped'], ['moto', 'Moto/skuter'], ['avto', 'Avtomobil']];
const DOCS = [['passport', 'Pasport (yuz tomoni)'], ['selfie', 'Pasport bilan selfi'], ['license', 'Haydovchilik guvohnomasi'], ['vehicle', 'Transport rasmi (ixtiyoriy)']];

const S = { token: store.get('dx_ktoken'), st: null, tab: 'main', poll: null, geo: null, lastLoc: 0, test: null, answers: [], offerSeen: null };

function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), err ? 4500 : 2500); }
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { S.token = null; store.set('dx_ktoken', null); render(); }
  if (!r.ok) throw new Error(j.error || 'Xatolik');
  return j;
}
const run = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };
const head = (t, right = '') => `<header class="ctop"><h1><span style="color:var(--accent)">●</span> ${t}</h1>${right}</header>`;

// Rasm: telefonda kamera → 1200 px JPEG
function pickPhoto() {
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
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

// GPS: liniyada bo'lganda har 10 soniyada yuboriladi
function startGeo() {
  if (S.geo != null || !navigator.geolocation) return;
  S.geo = navigator.geolocation.watchPosition((p) => {
    if (Date.now() - S.lastLoc < 10000) return;
    S.lastLoc = Date.now();
    api('POST', '/api/k/location', { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }).catch(() => {});
  }, () => toast('GPS yoqilmagan — buyurtma kelmaydi. Joylashuvga ruxsat bering', true), { enableHighAccuracy: true, maximumAge: 5000 });
}
function stopGeo() { if (S.geo != null) navigator.geolocation.clearWatch(S.geo); S.geo = null; }

async function refresh() {
  if (!S.token) return;
  const st = await api('GET', '/api/k/state').catch(() => null);
  if (!st) return;
  const newOffer = st.offer && st.offer.id !== S.offerSeen;
  S.st = st;
  if (st.me.online || st.order) startGeo(); else stopGeo();
  if (newOffer) { S.offerSeen = st.offer.id; S.offerTotal = Math.max(5, (new Date(st.offer.expires) - Date.now()) / 1000); try { navigator.vibrate?.([300, 150, 300]); } catch {} }
  // kod/matn yozilayotganda va "Hisob" sahifasida ekranni buzmaymiz (faqat yangi taklif kelsa)
  if (!newOffer && (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || $('#bapp')?.value || (S.tab === 'history' && st.me.status !== 'blocked'))) return;
  render();
}
function startPoll() { clearInterval(S.poll); S.poll = setInterval(() => { if (!document.hidden) refresh(); }, 3000); }

// ---------- Ekranlar ----------
function render() {
  const a = $('#app');
  if (!S.token) return viewLogin(a);
  if (!S.st) { a.innerHTML = head('Kuryer') + '<div class="empty">Yuklanmoqda…</div>'; return; }
  const me = S.st.me;
  if (['draft', 'rejected'].includes(me.status)) return viewRegister(a, me);
  if (me.status === 'pending') return (a.innerHTML = head('Kuryer', logoutBtn()) + `<div class="empty"><div class="ic">⏳</div><h2>Arizangiz tekshirilmoqda</h2>
    <p>Hujjatlaringizni platforma xodimi ko'rib chiqadi (odatda 1 ish kuni). Tasdiqlangach shu yerda ishni boshlaysiz.</p>
    <p class="muted small">Depozit topshirsangiz, naqd to'lovli buyurtmalar ham keladi.</p></div>`);
  if (me.status === 'blocked') return (a.innerHTML = head('Kuryer', logoutBtn()) + `<div class="empty"><div class="ic">⛔</div><h2>Hisobingiz bloklangan</h2><p>${esc(me.status_reason)}</p>
    <div class="panel" style="text-align:left"><h3>E'tiroz bildirish</h3><textarea id="bapp" rows="3" maxlength="1000" placeholder="Nega blokdan chiqarish kerakligini yozing"></textarea>
    <button class="btn primary block" style="margin-top:8px" data-a="blockAppeal">Yuborish</button></div></div>`);
  if (S.tab === 'history') return viewHistory(a);
  if (S.tab === 'rules') return viewRules(a);
  viewMain(a);
}
const logoutBtn = () => `<button class="btn sm" data-a="logout">Chiqish</button>`;
const tabs = () => `<nav class="tabsb">${[['main', '🛵 Ish'], ['history', '💰 Hisob'], ['rules', '📋 Qoidalar']].map(([k, n]) => `<button class="${S.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${n}</button>`).join('')}</nav>`;

function viewLogin(a) {
  a.innerHTML = head('Dasturxon Kuryer') + `<div class="csec"><div class="panel"><h3>Kuryer bo'lib ishlash</h3>
    <p class="muted small">O'z vaqtingizda ishlaysiz, har buyurtma uchun haq olasiz. Telefon raqamingiz bilan kiring.</p>
    <input id="ph" type="tel" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(store.get('dx_kphone') || '')}">
    <button class="btn primary block big" style="margin-top:12px" data-a="otp">Kod olish</button>
    <div id="s2" hidden><label>SMS kod</label><input id="code" class="otp" inputmode="numeric" maxlength="5">
    <button class="btn primary block big" style="margin-top:12px" data-a="login">Kirish</button><div id="dev" class="devcode"></div></div></div></div>`;
}

function viewRegister(a, me) {
  const step = !me.name || !me.vehicle ? 1 : !['passport', 'selfie', ...(['moto', 'avto'].includes(me.vehicle) ? ['license'] : [])].every((k) => me.docs.includes(k)) ? 2 : !me.test_passed ? 3 : 4;
  const cur = S.regStep || step;
  const bar = `<div class="steps">${[1, 2, 3, 4].map((i) => `<i class="${i <= cur ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (cur === 1) body = `<h3>1. Ma'lumotlaringiz</h3><label>Ism-familiya (pasportdagidek)</label><input id="nm" value="${esc(me.name)}">
    <label>Transport</label><div class="opts">${VEH.map(([k, n]) => `<button class="opt ${me.vehicle === k ? 'on' : ''}" data-a="veh" data-v="${k}"><i></i>${n}</button>`).join('')}</div>
    <div id="vnb" ${['moto', 'avto'].includes(S.veh || me.vehicle) ? '' : 'hidden'}><label>Davlat raqami</label><input id="vno" value="${esc(me.vehicle_no)}" placeholder="01A123BC"></div>
    <button class="btn primary block big" style="margin-top:14px" data-a="saveProfile">Davom etish</button>`;
  if (cur === 2) body = `<h3>2. Hujjatlar</h3><p class="muted small">Rasmlar faqat platforma xodimiga ko'rinadi. Aniq va o'qiladigan bo'lsin.</p>
    ${DOCS.filter(([k]) => k !== 'license' || ['moto', 'avto'].includes(me.vehicle)).map(([k, n]) => `<div class="docrow"><span class="grow">${me.docs.includes(k) ? '✅' : '⬜'} ${n}</span>
      <button class="btn sm ${me.docs.includes(k) ? '' : 'primary'}" data-a="doc" data-v="${k}">${me.docs.includes(k) ? 'Qayta' : '📷 Olish'}</button></div>`).join('')}
    <p class="muted small">MyID orqali shaxsni tasdiqlash platforma tomonidan qo'shiladi.</p>
    <div class="row"><button class="btn" data-a="regStep" data-v="1">Orqaga</button><button class="btn primary grow" data-a="regStep" data-v="3">Davom etish</button></div>`;
  if (cur === 3) body = S.test ? `<h3>3. Qoidalar testi</h3><p class="muted small">8 savoldan kamida 7 tasiga to'g'ri javob bering.</p>
    ${S.test.map((x, i) => `<div class="q"><b>${i + 1}. ${esc(x.q)}</b><div class="opts">${x.a.map((t, j) => `<button class="opt ${S.answers[i] === j ? 'on' : ''}" data-a="ans" data-q="${i}" data-v="${j}"><i></i>${esc(t)}</button>`).join('')}</div></div>`).join('')}
    <button class="btn primary block big" data-a="sendTest">Javoblarni yuborish</button>` : '<div class="empty">Yuklanmoqda…</div>';
  if (cur === 4) body = `<h3>4. Arizani yuborish</h3><div class="note ok">Ma'lumotlar, hujjatlar va test tayyor.</div>
    <p class="muted small" style="margin-top:12px">Tasdiqlangach <b>sinov davri</b> boshlanadi (birinchi buyurtmalar). Reyting 4.5 dan past bo'lsa — ogohlantirish, 4.0 dan past — blok.</p>
    <button class="btn primary block big" data-a="submit">Arizani yuborish</button>`;
  a.innerHTML = head("Ro'yxatdan o'tish", logoutBtn()) + `<div class="csec">${me.status === 'rejected' ? `<div class="note danger" style="margin-bottom:12px">Ariza rad etildi: ${esc(me.status_reason)}. Tuzatib qayta yuboring.</div>` : ''}<div class="panel">${bar}${body}</div></div>`;
  if (cur === 3 && !S.test) api('GET', '/api/k/test').then((t) => { S.test = t; render(); }).catch((e) => toast(e.message, true));
}

function viewMain(a) {
  const { me, offer, order } = S.st;
  let html = head(esc(me.name.split(' ')[0] || 'Kuryer'), `<span class="chip ok">${esc(me.level)}</span><span class="chip">⭐ ${me.ratings ? me.rating.toFixed(2) : '—'}</span>`);
  html += '<div class="csec">';
  if (me.mustSettle) html += `<div class="note danger" style="margin-bottom:12px">Qo'lingizdagi ${som(me.hand)} naqd 24 soatdan beri topshirilmagan. Topshirmaguningizcha yangi buyurtma kelmaydi.</div>`;
  if (me.rating_warn) html += `<div class="note warn" style="margin-bottom:12px">Reytingingiz ${me.rating.toFixed(2)} — 4.5 dan past. 4.0 dan tushsa hisob bloklanadi.</div>`;
  if (order) html += orderCard(order);
  else {
    html += `<button class="online ${me.online ? 'on' : ''}" data-a="online">${me.online ? '🟢 Liniyadasiz — buyurtma kutilmoqda' : '⚪ Liniyaga chiqish'}</button>
      <p class="muted small" style="text-align:center">${me.online ? "Ilovani yopmang. GPS yoqilgan bo'lishi kerak." : "Liniyaga chiqsangiz, yaqin buyurtmalar taklif qilinadi."}</p>`;
  }
  html += `<div class="kstats" style="margin-top:14px">
    <div class="stat"><div class="muted small">Bugungi daromad</div><div class="v">${som(me.earnedToday)}</div></div>
    <div class="stat"><div class="muted small">Qo'lingizdagi naqd</div><div class="v" style="${me.hand ? 'color:var(--warn)' : ''}">${som(me.hand)}</div></div>
    <div class="stat"><div class="muted small">Naqd limiti</div><div class="v">${som(me.cash_limit)}</div><div class="muted small">depozit ${money(me.deposit)}</div></div>
    <div class="stat"><div class="muted small">Yetkazilgan</div><div class="v">${me.completed}</div>${me.level_bonus ? `<div class="muted small">+${money(me.level_bonus)} bonus/buyurtma</div>` : ''}</div></div>
    ${me.status === 'probation' ? `<div class="note" style="margin-top:12px">Sinov davri: yana <b>${me.probation_left}</b> ta buyurtma.</div>` : ''}
    ${me.next_level ? `<p class="muted small">Keyingi daraja — <b>${me.next_level.name}</b>: ${me.next_level.min} ta buyurtma, reyting ${me.next_level.rating}+, bonus ${money(me.next_level.bonus)}/buyurtma.</p>` : ''}
    </div>${tabs()}`;
  if (offer && !order) html += offerBox(offer);
  a.innerHTML = html;
  if (offer) tickOffer();
}
function offerBox(o) {
  return `<div class="offer"><div class="box"><div class="row"><b style="font-size:18px" class="grow">Yangi buyurtma</b><span class="chip" id="otime"></span></div>
    <div class="bar"><i id="obar" style="width:100%"></i></div>
    <div class="fee">${som(o.fee)}</div>
    <div style="margin:10px 0"><b>${esc(o.place)}</b>${o.to_place_km != null ? ` · ${kmTxt(o.to_place_km)} sizdan` : ''}<div class="muted small">${esc(o.place_address || '')}</div></div>
    <div>📍 ${esc(o.address)}${o.trip_km != null ? ` <span class="muted small">(${kmTxt(o.trip_km)} yo'l)</span>` : ''}</div>
    <div class="muted small" style="margin-top:4px">${o.items} ta taom · ${o.cash ? `<b style="color:var(--warn)">naqd olish: ${som(o.cash)}</b>` : "to'langan"}</div>
    <div class="row" style="margin-top:16px"><button class="btn big" data-a="decline" data-id="${o.id}">Rad etish</button><button class="btn primary big grow" data-a="accept" data-id="${o.id}">Qabul qilish</button></div></div></div>`;
}
function tickOffer() {
  const o = S.st?.offer; if (!o) return;
  const left = Math.max(0, (new Date(o.expires) - Date.now()) / 1000), total = S.offerTotal || 30;
  const t = $('#otime'), b = $('#obar'); if (t) t.textContent = `${Math.ceil(left)} s`; if (b) b.style.width = Math.min(100, (left / total) * 100) + '%';
}
setInterval(tickOffer, 1000);

function orderCard(o) {
  const cs = o.courier_status, steps = ['assigned', 'at_restaurant', 'picked', 'at_customer'];
  const idx = steps.indexOf(cs);
  const bar = `<div class="steps">${steps.map((s, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`;
  const place = `<div><b>${esc(o.place.name)}</b><div class="muted small">${esc(o.place.address || '')}</div>${o.place.lat != null ? `<a class="btn sm" style="margin-top:8px" target="_blank" rel="noopener" href="${mapUrl(o.place.lat, o.place.lng)}">🧭 Yo'l</a>` : ''}</div>`;
  const cust = `<div><b>${esc(o.customer.name || 'Mijoz')}</b> · <a href="tel:+${esc(o.customer.phone)}" data-a="call" data-id="${o.id}">${fmtPhone(o.customer.phone)}</a>
    <div>📍 ${esc(o.customer.address)}</div>${o.customer.note ? `<div class="muted small">💬 ${esc(o.customer.note)}</div>` : ''}
    <div class="row" style="margin-top:8px;gap:8px">${o.customer.lat != null ? `<a class="btn sm" target="_blank" rel="noopener" href="${mapUrl(o.customer.lat, o.customer.lng)}">🧭 Yo'l</a>` : ''}<a class="btn sm" href="tel:+${esc(o.customer.phone)}" data-a="call" data-id="${o.id}">📞 Qo'ng'iroq</a></div></div>`;
  const items = `<div class="muted small" style="margin-top:8px">${o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join(', ')}</div>`;
  const cash = o.cash ? `<div class="note warn" style="margin-top:10px">Mijozdan naqd olasiz: <span class="cash">${som(o.cash)}</span></div>` : `<div class="note ok" style="margin-top:10px">To'langan — mijozdan pul olmaysiz</div>`;
  let body = '';
  if (cs === 'assigned') body = `<h3>Restoranga boring</h3>${place}${items}<button class="btn primary block big" style="margin-top:14px" data-a="kact" data-v="arrived_rest" data-id="${o.id}">Restoranga yetib keldim</button>
    <button class="btn ghost block" style="margin-top:8px" data-a="release" data-id="${o.id}">Voz kechish</button>`;
  if (cs === 'at_restaurant') body = `<h3>Buyurtmani oling</h3>${place}${items}
    <div class="note" style="margin-top:10px">Paket yopiq (plombali) ekanini tekshiring. Ochiq yoki yirtilgan bo'lsa — olmang, restoranga ayting.</div>
    ${o.status === 'ready' ? '' : `<div class="note warn" style="margin-top:10px">Restoran hali tayyorlamoqda…</div>`}
    <button class="btn primary block big" style="margin-top:14px" data-a="pickup" data-id="${o.id}" ${o.status === 'ready' ? '' : 'disabled'}>📷 Plomba rasmini olib, buyurtmani oldim</button>
    <button class="btn ghost block" style="margin-top:8px" data-a="release" data-id="${o.id}">Voz kechish</button>`;
  if (cs === 'picked') body = `<h3>Mijozga yetkazing</h3>${cust}${cash}<button class="btn primary block big" style="margin-top:14px" data-a="kact" data-v="arrived" data-id="${o.id}">Yetib keldim</button>
    <div class="row" style="margin-top:10px"><input id="kcode" class="codein grow" inputmode="numeric" maxlength="4" placeholder="····"><button class="btn primary big" data-a="deliver" data-id="${o.id}">Topshirdim</button></div>`;
  if (cs === 'at_customer') {
    const left = Math.max(0, new Date(o.noshow_at) - Date.now());
    body = `<h3>Topshirish</h3>${cust}${cash}<label style="margin-top:14px">Mijozdan 4 xonali kodni so'rang</label>
      <input id="kcode" class="codein" inputmode="numeric" maxlength="4" placeholder="····">
      <button class="btn primary block big" style="margin-top:10px" data-a="deliver" data-id="${o.id}">Topshirdim</button>
      <details style="margin-top:18px"><summary class="muted">Mijoz chiqmayaptimi?</summary><div class="panel" style="margin-top:10px">
        <p class="small">1) Qo'ng'iroq qiling ${o.call_at ? '✅' : ''} &nbsp; 2) Eshik/manzil rasmini oling ${o.door_photo ? '✅' : ''} &nbsp; 3) 10 daqiqa kuting</p>
        <div class="row" style="gap:8px"><a class="btn sm" href="tel:+${esc(o.customer.phone)}" data-a="call" data-id="${o.id}">📞 Qo'ng'iroq</a><button class="btn sm" data-a="door" data-id="${o.id}">📷 Eshik rasmi</button></div>
        <div class="timer" id="nstimer" data-at="${o.noshow_at}" style="margin:12px 0">${left ? '' : '00:00'}</div>
        <button class="btn danger block" data-a="noshow" data-id="${o.id}">Mijoz olmadi</button>
        <p class="muted small">Tartib bajarilsa yo'l haqingiz to'lanadi, taom sizda qoladi.</p></div></details>`;
  }
  return `<div class="panel">${bar}${body}<div class="muted small" style="margin-top:12px">Buyurtma #${o.id} · haqingiz ${som(o.fee)}</div></div>`;
}
setInterval(() => { const t = $('#nstimer'); if (!t) return; const l = Math.max(0, new Date(t.dataset.at) - Date.now()); t.textContent = `${String(Math.floor(l / 60000)).padStart(2, '0')}:${String(Math.floor((l % 60000) / 1000)).padStart(2, '0')}`; }, 1000);

async function viewHistory(a) {
  const me = S.st.me;
  a.innerHTML = head('Hisob') + '<div class="empty">Yuklanmoqda…</div>' + tabs();
  const [h, ds] = await Promise.all([api('GET', '/api/k/history').catch(() => ({ orders: [], moves: [] })), api('GET', '/api/k/disputes').catch(() => [])]);
  const TN = { fee: "Yetkazish haqi", bonus: 'Bonus', cash: 'Naqd olindi', cash_in: 'Naqd topshirildi', payout: "Sizga to'landi", penalty: 'Jarima', deposit: 'Depozit', note: 'Izoh' };
  const PARTY = { customer: 'Mijoz', restaurant: 'Restoran', courier: 'Siz', platform: 'Platforma', none: 'hech kim' };
  const DST = { open: ["Ko'rib chiqilmoqda", 'warn'], resolved: ['Hal qilindi', 'ok'], rejected: ['Rad etildi', ''] };
  const MEAS = { warn: 'ogohlantirish', fine: 'jarima', block: 'blok', unblock: 'blokdan chiqarildi' };
  const disputes = `<div class="panel"><h3>Shikoyat va nizolar</h3>${ds.map((d) => `<div class="line" style="align-items:flex-start"><div class="grow">
      <div><b>#${d.id}</b> ${d.order_id ? `· buyurtma #${d.order_id} ` : ''}· ${PARTY[d.opened_by]}${d.against ? ' → ' + PARTY[d.against] : ''} <span class="chip ${DST[d.status]?.[1] || ''}">${d.appeal_status === 'open' ? "E'tiroz ko'rilmoqda" : DST[d.status]?.[0] || d.status}</span></div>
      <div class="muted small">${esc(d.category_name)}: ${esc(d.text)}</div>
      ${d.status !== 'open' ? `<div class="small">Qaror: aybdor — ${PARTY[d.guilty] || '—'}${d.measure ? `, ${MEAS[d.measure]}` : ''}${d.recover && d.appeal_status !== 'accepted' ? `, undirildi ${som(d.recover)}` : ''}. ${esc(d.resolution)}${d.guilty !== 'courier' ? '' : d.appeal_status === 'accepted' ? " <b>E'tirozingiz qabul qilindi.</b>" : d.appeal_status === 'rejected' ? " E'tiroz rad etildi." : ''}</div>` : ''}
      <div class="row" style="gap:6px;margin-top:6px">${d.status === 'open' || d.appeal_status === 'open' ? `<button class="btn sm" data-a="dNote" data-id="${d.id}">Javob yozish</button>` : ''}${d.can_appeal ? `<button class="btn sm primary" data-a="dAppeal" data-id="${d.id}">E'tiroz bildirish</button>` : ''}</div>
    </div></div>`).join('') || '<div class="muted small">Nizo yo\'q</div>'}
    ${h.orders.length ? `<details style="margin-top:10px"><summary class="small">⚠️ Muammo bildirish (restoran yoki mijoz)</summary>
      <select id="dOrder">${h.orders.map((o) => `<option value="${o.id}">#${o.id} · ${esc(o.place || '')}</option>`).join('')}</select>
      <select id="dAgainst"><option value="restaurant">Restoranga</option><option value="customer">Mijozga</option></select>
      <select id="dCat"><option value="restaurant_delay">Restoran kechiktirdi</option><option value="damaged">Paket ochiq / shikastlangan edi</option><option value="customer_abuse">Mijoz bilan muammo</option><option value="payment">To'lov / naqd muammosi</option><option value="other">Boshqa</option></select>
      <textarea id="dText" rows="2" maxlength="1000" placeholder="Nima bo'ldi?"></textarea><button class="btn sm primary block" data-a="dOpen">Yuborish</button></details>` : ''}</div>`;
  a.innerHTML = head('Hisob') + `<div class="csec"><div class="kstats">
    <div class="stat"><div class="muted small">Platforma sizga qarzdor</div><div class="v">${som(Math.max(0, me.balance))}</div></div>
    <div class="stat"><div class="muted small">Siz topshirasiz</div><div class="v" style="color:var(--warn)">${som(Math.max(0, -me.balance))}</div></div></div>
    <p class="muted small">Naqdni har kuni (24 soat ichida) topshiring. Daromad hisob-kitobda to'lanadi.</p>
    ${disputes}
    <div class="panel"><h3>Harakatlar</h3>${h.moves.map((m) => `<div class="line"><div class="grow"><div>${TN[m.type] || m.type}${m.order_id ? ` · #${m.order_id}` : ''}</div><div class="muted small">${dt(m.at)} ${esc(m.note)}</div></div><b class="num" style="color:${m.amount < 0 ? 'var(--warn)' : 'var(--accent)'}">${m.amount > 0 ? '+' : ''}${money(m.amount)}</b></div>`).join('') || '<div class="muted">—</div>'}</div>
    <div class="panel"><h3>Buyurtmalar</h3>${h.orders.map((o) => `<div class="line"><div class="grow"><div>#${o.id} · ${esc(o.place || '')}</div><div class="muted small">${dt(o.delivered_at || o.updated_at)} · ${o.status === 'delivered' ? 'yetkazildi' : 'mijoz olmadi'}${o.courier_rating ? ` · ⭐${o.courier_rating}` : ''}</div></div><b class="num">${money(o.courier_fee)}</b></div>`).join('') || '<div class="muted">—</div>'}</div>
    <button class="btn block" data-a="logout">Chiqish</button></div>${tabs()}`;
}
function viewRules(a) {
  a.innerHTML = head('Qoidalar') + `<div class="csec"><div class="panel small">
    <p><b>Olish:</b> faqat yopiq (plombali) paketni oling va rasmini ilovada oling.</p>
    <p><b>Topshirish:</b> mijozdan 4 xonali kodni so'rang. Kodsiz bermang.</p>
    <p><b>Mijoz chiqmasa:</b> qo'ng'iroq qiling, eshik rasmini oling, 10 daqiqa kuting, keyin "Mijoz olmadi". Yo'l haqingiz to'lanadi, taom sizda qoladi.</p>
    <p><b>Naqd:</b> olgan naqdni 24 soat ichida topshiring. Qo'lingizdagi naqd limitdan oshmaydi (depozit va darajaga bog'liq).</p>
    <p><b>Reyting:</b> 4.5 dan past — ogohlantirish, 4.0 dan past — blok. E'tiroz huquqingiz bor.</p>
    <p><b>Darajalar:</b> Yangi → Bronza (20 ta, 4.5+) → Kumush (100 ta, 4.7+) → Oltin (300 ta, 4.85+). Har darajada bonus va naqd limiti oshadi.</p>
    <p><b>Voz kechish:</b> faqat restorandan olishdan oldin mumkin va hisobga olinadi.</p></div></div>${tabs()}`;
}

// ---------- Harakatlar ----------
const A = {
  otp: async (el) => {
    const phone = $('#ph').value; el.disabled = true;
    const r = await run(() => api('POST', '/api/k/otp', { phone }));
    if (!r) { el.disabled = false; return; }
    setTimeout(() => { el.disabled = false; }, 60000);
    store.set('dx_kphone', phone); $('#s2').hidden = false; if (r.dev_code) $('#dev').textContent = `Sinov rejimi: kod — ${r.dev_code}`; $('#code').focus();
  },
  login: async () => {
    const r = await run(() => api('POST', '/api/k/login', { phone: $('#ph').value, code: $('#code').value }));
    if (!r) return; S.token = r.token; store.set('dx_ktoken', r.token); await refresh(); startPoll();
  },
  logout: async () => { await api('POST', '/api/k/logout').catch(() => {}); S.token = null; S.st = null; store.set('dx_ktoken', null); stopGeo(); render(); },
  tab: (el) => { S.tab = el.dataset.v; render(); },
  veh: (el) => { S.veh = el.dataset.v; document.querySelectorAll('[data-a="veh"]').forEach((b) => b.classList.toggle('on', b === el)); $('#vnb').hidden = !['moto', 'avto'].includes(S.veh); },
  saveProfile: async () => {
    const r = await run(() => api('POST', '/api/k/profile', { name: $('#nm').value, vehicle: S.veh || S.st.me.vehicle, vehicle_no: $('#vno')?.value }));
    if (r) { S.st.me = r; S.regStep = 2; render(); }
  },
  regStep: (el) => { S.regStep = Number(el.dataset.v); render(); },
  doc: async (el) => {
    const d = await pickPhoto(); if (!d) return;
    const r = await run(() => api('POST', '/api/k/docs', { kind: el.dataset.v, data: d }));
    if (r) { S.st.me = r; toast('Yuklandi'); render(); }
  },
  ans: (el) => { S.answers[Number(el.dataset.q)] = Number(el.dataset.v); el.parentElement.querySelectorAll('.opt').forEach((b) => b.classList.toggle('on', b === el)); },
  sendTest: async () => {
    if (S.answers.filter((x) => x != null).length < S.test.length) return toast('Hamma savolga javob bering', true);
    const r = await run(() => api('POST', '/api/k/test', { answers: S.answers }));
    if (!r) return;
    if (r.passed) { toast(`Testdan o'tdingiz: ${r.score}/${r.total}`); S.regStep = 4; } else toast(`${r.score}/${r.total} — o'tmadi. Xato savollar: ${r.wrong.map((i) => i + 1).join(', ')}. 10 daqiqadan keyin qayta urining`, true);
    S.answers = []; await refresh();
  },
  submit: async () => { const r = await run(() => api('POST', '/api/k/submit')); if (r) { S.regStep = null; await refresh(); } },
  online: async () => {
    const on = !S.st.me.online;
    if (on) startGeo();
    const r = await run(() => api('POST', '/api/k/online', { online: on }));
    if (r) { S.st.me = r; if (!on) stopGeo(); render(); }
  },
  accept: async (el) => { const r = await run(() => api('POST', `/api/k/offers/${el.dataset.id}/accept`)); if (r) toast('Buyurtma sizda! Restoranga boring'); refresh(); },
  decline: async (el) => { await run(() => api('POST', `/api/k/offers/${el.dataset.id}/decline`)); refresh(); },
  kact: async (el) => { el.disabled = true; await run(() => api('POST', `/api/k/orders/${el.dataset.id}/${el.dataset.v}`)); refresh(); },
  pickup: async (el) => {
    const d = await pickPhoto(); if (!d) return;
    const r = await run(() => api('POST', `/api/k/orders/${el.dataset.id}/pickup`, { photo: d }));
    if (r) toast("Olindi. Mijozga yo'l oling"); refresh();
  },
  call: (el) => { api('POST', `/api/k/orders/${el.dataset.id}/call`).catch(() => {}); },
  door: async (el) => {
    const d = await pickPhoto(); if (!d) return;
    if (await run(() => api('POST', `/api/k/orders/${el.dataset.id}/door`, { photo: d }))) { toast('Rasm saqlandi'); refresh(); }
  },
  deliver: async (el) => {
    const code = $('#kcode')?.value.trim();
    if (!/^\d{4}$/.test(code || '')) return toast('4 xonali kodni kiriting', true);
    const r = await run(() => api('POST', `/api/k/orders/${el.dataset.id}/deliver`, { code }));
    if (r) toast(r.cash ? `Yetkazildi! Naqd ${som(r.cash)} oldingiz. Haqingiz +${som(r.fee)}` : `Yetkazildi! Haqingiz +${som(r.fee)}`);
    $('#kcode') && ($('#kcode').value = ''); refresh();
  },
  noshow: async (el) => {
    if (!confirm("Mijoz buyurtmani olmadi deb belgilaymizmi? Taom sizda qoladi.")) return;
    const r = await run(() => api('POST', `/api/k/orders/${el.dataset.id}/noshow`));
    if (r) toast(`Belgilandi. Yo'l haqingiz +${som(r.fee)}`); refresh();
  },
  // 8-etap: nizolar
  dNote: async (el) => { const text = prompt('Javobingiz (isbot, tushuntirish):'); if (text && (await run(() => api('POST', `/api/k/disputes/${el.dataset.id}/note`, { text })))) { toast('Yuborildi'); render(); } },
  dAppeal: async (el) => { const text = prompt("E'tirozingizni yozing (faqat bir marta):"); if (text && (await run(() => api('POST', `/api/k/disputes/${el.dataset.id}/appeal`, { text })))) { toast("E'tiroz yuborildi"); render(); } },
  dOpen: async () => {
    const text = $('#dText').value.trim(); if (text.length < 3) return toast("Muammoni yozing", true);
    if (await run(() => api('POST', '/api/k/disputes', { order_id: Number($('#dOrder').value), against: $('#dAgainst').value, category: $('#dCat').value, text }))) { toast('Yuborildi'); render(); }
  },
  blockAppeal: async () => {
    const text = $('#bapp').value.trim(); if (text.length < 10) return toast('Batafsilroq yozing', true);
    if (await run(() => api('POST', '/api/k/disputes', { category: 'block_appeal', text }))) { $('#bapp').value = ''; toast("E'tirozingiz platformaga yuborildi"); }
  },
  release: async (el) => {
    const reason = prompt('Nega voz kechyapsiz? (bu hisobga olinadi)'); if (reason == null) return;
    if (await run(() => api('POST', `/api/k/orders/${el.dataset.id}/release`, { reason }))) toast('Buyurtma boshqa kuryerga berildi');
    refresh();
  },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]'); if (!el || !A[el.dataset.a]) return;
  if (el.tagName !== 'A') e.preventDefault();
  A[el.dataset.a](el, e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'code') A.login(); });
window.addEventListener('DOMContentLoaded', async () => { render(); if (S.token) { await refresh(); startPoll(); } });
})();
