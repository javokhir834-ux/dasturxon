// FastHub Kuryer — kuryer ilovasi (FastHub prototipi dizayni, qorong'i): ro'yxat, liniya, takliflar, olish va topshirish, daromad, profil.
// Build'siz vanilla JS. Ikonkalar: /lucide.js (ic).
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
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const VEH = [['piyoda', 'Piyoda', 'user'], ['velosiped', 'Velosiped', 'bike'], ['moto', 'Moto/skuter', 'bike'], ['avto', 'Avtomobil', 'truck']];
const DOCS = [['passport', 'Pasport (yuz tomoni)', 'id-card'], ['selfie', 'Pasport bilan selfi', 'scan-face'], ['license', 'Haydovchilik guvohnomasi', 'credit-card'], ['vehicle', 'Transport rasmi (ixtiyoriy)', 'bike']];
const RING = 151; // taklif doirasi uzunligi (r=24)

const S = { token: store.get('dx_ktoken'), st: null, tab: 'main', poll: null, geo: null, lastLoc: 0, test: null, answers: [], offerSeen: null, q: null, cq: null, cans: [] };

function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : '');
  t.innerHTML = ic(err ? 'info' : 'circle-check', 20) + `<span>${esc(msg)}</span>`; $('#toasts').append(t); setTimeout(() => t.remove(), err ? 4500 : 2500);
}
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { S.token = null; store.set('dx_ktoken', null); render(); }
  if (!r.ok) throw new Error(j.error || 'Xatolik');
  return j;
}
const run = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };

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
  const watch = window.DX?.watchPosition || ((ok, fail, o) => navigator.geolocation.watchPosition(ok, fail, o)); // ilovada — fonda GPS
  S.geo = watch((p) => {
    if (Date.now() - S.lastLoc < 10000) return;
    S.lastLoc = Date.now();
    api('POST', '/api/k/location', { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }).catch(() => {});
  }, () => toast('GPS yoqilmagan — buyurtma kelmaydi. Joylashuvga ruxsat bering', true), { enableHighAccuracy: true, maximumAge: 5000 });
}
function stopGeo() { if (S.geo != null) { if (window.DX?.watchPosition) DX.clearWatch(S.geo); else navigator.geolocation.clearWatch(S.geo); } S.geo = null; }

async function refresh() {
  if (!S.token) return;
  const st = await api('GET', '/api/k/state').catch(() => null);
  if (!st) return;
  const newOffer = st.offer && st.offer.id !== S.offerSeen;
  const prevStatus = S.st?.me?.status;
  S.st = st;
  // Ro'yxat bosqichida ekran faqat harakatdan keyin (S.force) yoki holat o'zgarganda qayta chiziladi — yozilgan javoblar o'chmasin
  if (['draft', 'rejected'].includes(st.me.status) && prevStatus === st.me.status && !S.force) return;
  S.force = false;
  if (st.me.online || st.order) startGeo(); else stopGeo();
  if (newOffer) { S.offerSeen = st.offer.id; S.offerTotal = Math.max(5, (new Date(st.offer.expires) - Date.now()) / 1000); try { navigator.vibrate?.([300, 150, 300]); } catch {} }
  // kod/matn yozilayotganda va Daromad/Profil sahifasida ekranni buzmaymiz (faqat yangi taklif kelsa)
  if (!newOffer && (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || $('#bapp')?.value || $('.trip details[open]') || (S.tab !== 'main' && st.me.status !== 'blocked'))) return;
  render();
}
function startPoll() { clearInterval(S.poll); S.poll = setInterval(() => { if (!document.hidden) refresh(); }, 3000); }

// ---------- Umumiy ----------
const TABS = [['main', 'package', 'Buyurtma'], ['history', 'chart-column', 'Daromad'], ['profile', 'user', 'Profil']];
const tabbar = () => `<nav class="tabbar">${TABS.map(([k, i, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${ic(i, 25, { w: S.tab === k ? 2.3 : 1.9 })}${l}</button>`).join('')}</nav>`;
// Poll har 3 s qayta chizadi — ekran (tab, holat, buyurtma bosqichi) o'zgarmasa, paydo bo'lish animatsiyasi takrorlanmaydi
const screen = (html, tabs = true) => {
  const me = S.st?.me, key = [S.token ? 1 : 0, S.tab, me?.status, S.st?.order?.courier_status, S.st?.offer?.id, S.regStep].join('|');
  const still = key === S.lastKey; S.lastKey = key;
  const oldMap = $('#kmap'); // xarita plitkalari har 3 s qayta yuklanmasin
  $('#app').innerHTML = `<div class="scr ${still ? 'still' : ''}">${html}</div>${tabs ? tabbar() : ''}`;
  MiniMap.keep(oldMap, '#kmap');
};
const title = (t, right = '') => `<div class="row sb" style="margin:0 4px 14px"><h1 class="h1">${t}</h1>${right}</div>`;
const logoutBtn = () => `<button class="btn sm sec" data-a="logout">${ic('log-out', 16)} Chiqish</button>`;
const legalLink = (page, text) => `<a href="${esc(DX.asset('/legal/' + page))}" target="_blank" rel="noopener">${text}</a>`;
const status = (icon, h, p, extra = '') => screen(`${title('Kuryer', logoutBtn())}<div class="empty"><span class="big">${ic(icon, 36, { w: 1.7 })}</span><h2>${h}</h2><p class="mut">${p}</p>${extra}</div>`, false);

function render() {
  if (!S.token) return viewLogin();
  if (!S.st) return screen('<div class="empty"><span class="mut">Yuklanmoqda…</span></div>', false);
  const me = S.st.me;
  if (['draft', 'rejected'].includes(me.status)) return viewRegister(me);
  if (me.status === 'pending') return status('clipboard-list', 'Arizangiz tekshirilmoqda', "Hujjatlaringizni platforma xodimi ko'rib chiqadi (odatda 1 ish kuni). Tasdiqlangach shu yerda ishni boshlaysiz. Depozit topshirsangiz, naqd to'lovli buyurtmalar ham keladi.");
  if (me.status === 'deleting') return status('x', "O'chirish so'ralgan", "Hisob-kitob (naqd, daromad, depozit) yakunlangach akkauntingiz o'chiriladi. Platforma siz bilan bog'lanadi.");
  if (me.status === 'blocked') return status('shield-check', 'Hisobingiz bloklangan', esc(me.status_reason), `<div class="card" style="width:100%;text-align:left">
    <b>E'tiroz bildirish</b><textarea id="bapp" class="inp" style="margin-top:10px" rows="3" maxlength="1000" placeholder="Nega blokdan chiqarish kerakligini yozing"></textarea>
    <button class="btn" style="margin-top:10px" data-a="blockAppeal">Yuborish</button></div>`);
  if (S.tab === 'history') return viewHistory();
  if (S.tab === 'profile') return viewProfile();
  viewMain();
}

// ---------- Kirish va ro'yxat ----------
function viewLogin() {
  screen(`<div style="margin:18px 4px 18px"><span class="ava lg" style="background:var(--acc);margin-bottom:16px">${ic('bike', 30)}</span>
      <h1 class="h1">FastHub Kuryer</h1><p class="mut" style="margin:6px 0 0">O'z vaqtingizda ishlaysiz, har buyurtma uchun haq olasiz.</p></div>
    <div class="card"><span class="flabel" style="margin-top:0">Telefon raqam</span><input id="ph" class="inp" type="tel" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(store.get('dx_kphone') || '')}">
      <button class="btn" style="margin-top:12px" data-a="otp">Kod olish</button>
      <div id="s2" hidden><span class="flabel">SMS kod</span><input id="code" class="inp otp" inputmode="numeric" maxlength="5">
        <button class="btn" style="margin-top:12px" data-a="login">Kirish</button><div id="dev" class="devcode"></div></div></div>
    <p class="mut sm" style="text-align:center;margin:14px 10px">Kirish orqali ${legalLink('terms', 'foydalanish shartlari')} va ${legalLink('privacy', 'maxfiylik siyosati')}ga rozilik bildirasiz.</p>`, false);
}
// Ro'yxat: 6 bosqich — ma'lumot, so'rovnoma, hujjatlar, qoidalar testi, maxfiylik va rozilik (onboarding.ts), ariza
const DISTRICTS = ['Navoiy shahri', 'Karmana', 'Zarafshon', 'Uchquduq', 'Nurota', 'Qiziltepa', 'Xatirchi', 'Navbahor', 'Konimex', 'Tomdi', 'Boshqa'];
const SLOTS = [['ertalab', 'Ertalab'], ['kunduzi', 'Kunduzi'], ['kechqurun', 'Kechqurun'], ['tunda', 'Tunda']];
function viewRegister(me) {
  const need = ['passport', 'selfie', ...(['moto', 'avto'].includes(me.vehicle) ? ['license'] : [])];
  const step = !me.name || !me.vehicle ? 1 : !me.application_done ? 2 : !need.every((k) => me.docs.includes(k)) ? 3 : !me.test_passed ? 4 : !me.consent_done ? 5 : 6;
  const cur = S.regStep || step;
  const bar = `<div class="steps" style="margin-bottom:16px">${["Ma'lumot", "So'rovnoma", 'Hujjat', 'Test', 'Rozilik', 'Ariza'].map((l, i) => `<span class="${i + 1 <= cur ? 'on' : ''}"><i></i>${l}</span>`).join('')}</div>`;
  const radioList = (a, cur2, opts) => `<div class="list">${opts.map(([k, n, i]) => `<button class="li press ${cur2 === k ? 'on' : ''}" data-a="${a}" data-v="${k}">${i ? `<span class="ib">${ic(i, 18)}</span>` : ''}<b class="grow" style="font-weight:600">${n}</b><span class="radio"></span></button>`).join('')}</div>`;
  let body = '';
  if (cur === 1) body = `<b style="font-size:20px">Ma'lumotlaringiz</b><span class="flabel">Ism-familiya (pasportdagidek)</span><input id="nm" class="inp" value="${esc(me.name)}">
    <span class="flabel">Transport</span>${radioList('veh', S.veh || me.vehicle, VEH)}
    <div id="vnb" ${['moto', 'avto'].includes(S.veh || me.vehicle) ? '' : 'hidden'}><span class="flabel">Davlat raqami</span><input id="vno" class="inp" value="${esc(me.vehicle_no)}" placeholder="01A123BC"></div>
    <button class="btn big" style="margin-top:16px" data-a="saveProfile">Davom etish</button>`;
  if (cur === 2) { const q = S.q || (S.q = { availability: [] }); body = `<b style="font-size:20px">So'rovnoma</b><p class="mut sm" style="margin:4px 0 0">Platforma sizga mos buyurtmalarni berishi uchun.</p>
    <span class="flabel">Tug'ilgan yilingiz</span><input id="by" class="inp" type="number" inputmode="numeric" placeholder="1998" value="${esc(q.birth_year || '')}">
    <span class="flabel">Qaysi hududda ishlaysiz?</span><select id="dist" class="inp">${['', ...DISTRICTS].map((d) => `<option value="${esc(d)}" ${q.district === d ? 'selected' : ''}>${d || '— tanlang —'}</option>`).join('')}</select>
    <span class="flabel">Qaysi vaqtlarda ishlaysiz? (bir nechtasini tanlang)</span><div class="row" style="flex-wrap:wrap;gap:8px">${SLOTS.map(([k, n]) => `<button class="pill press ${q.availability.includes(k) ? 'acc' : ''}" style="height:38px;padding:0 14px;font-size:14px" data-a="slot" data-v="${k}">${n}</button>`).join('')}</div>
    <span class="flabel">Kuryerlik tajribangiz bormi?</span>${radioList('exp', q.experience == null ? '' : q.experience ? 'yes' : 'no', [['yes', 'Ha, ishlaganman'], ['no', "Yo'q, birinchi marta"]])}
    <label class="li" style="margin-top:6px"><input id="gps" type="checkbox" ${q.smartphone_gps ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--acc-hi)"><b class="grow" style="font-weight:600">GPS li smartfonim va internetim bor</b></label>
    <div class="row" style="margin-top:12px"><button class="btn sec" style="width:auto" data-a="regStep" data-v="1">Orqaga</button><button class="btn" data-a="saveApp">Davom etish</button></div>`; }
  if (cur === 3) body = `<b style="font-size:20px">Hujjatlar</b><p class="mut sm" style="margin:4px 0 6px">Rasmlar faqat platforma xodimiga ko'rinadi. Aniq va o'qiladigan bo'lsin.</p>
    <div class="list">${DOCS.filter(([k]) => k !== 'license' || ['moto', 'avto'].includes(me.vehicle)).map(([k, n, i]) => `<div class="li"><span class="ib">${ic(i, 18)}</span><span class="t"><b>${n}</b><span>${me.docs.includes(k) ? 'Yuklangan' : 'Kerak'}</span></span>
      <button class="btn sm ${me.docs.includes(k) ? 'sec' : ''}" data-a="doc" data-v="${k}">${me.docs.includes(k) ? 'Qayta' : 'Rasmga olish'}</button></div>`).join('')}</div>
    <p class="mut xs">MyID orqali shaxsni tasdiqlash platforma tomonidan qo'shiladi.</p>
    <div class="row" style="margin-top:10px"><button class="btn sec" style="width:auto" data-a="regStep" data-v="2">Orqaga</button><button class="btn" data-a="regStep" data-v="4">Davom etish</button></div>`;
  if (cur === 4) body = S.test ? `<b style="font-size:20px">Qoidalar testi</b><p class="mut sm" style="margin:4px 0 0">${S.test.length} savoldan kamida ${S.test.length - 1} tasiga to'g'ri javob bering.</p>
    ${S.test.map((x, i) => `<div class="q"><b>${i + 1}. ${esc(x.q)}</b><div class="card2 list" style="padding:0 14px">${x.a.map((t, j) => `<button class="li press ${S.answers[i] === j ? 'on' : ''}" data-a="ans" data-q="${i}" data-v="${j}"><span class="grow" style="font-size:14px">${esc(t)}</span><span class="radio"></span></button>`).join('')}</div></div>`).join('')}
    <button class="btn big" style="margin-top:16px" data-a="sendTest">Javoblarni yuborish</button>` : '<p class="mut">Yuklanmoqda…</p>';
  if (cur === 5) body = S.cq ? `<b style="font-size:20px">Maxfiylik va shartlar</b>
    <p class="mut sm" style="margin:4px 0 8px">Ishni boshlashdan oldin asosiy qoidalarni o'qing. To'liq matn: ${legalLink('privacy', 'maxfiylik siyosati')} va ${legalLink('terms', 'foydalanish shartlari')}.</p>
    <div class="card2 col" style="gap:8px">${S.cq.points.map((t, i) => `<div class="row" style="align-items:flex-start;gap:10px"><span class="pill acc" style="height:24px;min-width:24px;justify-content:center;padding:0">${i + 1}</span><span class="sm" style="color:#D4D4D8">${esc(t)}</span></div>`).join('')}</div>
    <b style="display:block;margin-top:16px">O'qiganingizni tekshiramiz</b>
    ${S.cq.questions.map((x, i) => `<div class="q"><b>${i + 1}. ${esc(x.q)}</b><div class="card2 list" style="padding:0 14px">${x.a.map((t, j) => `<button class="li press ${S.cans[i] === j ? 'on' : ''}" data-a="cans" data-q="${i}" data-v="${j}"><span class="grow" style="font-size:14px">${esc(t)}</span><span class="radio"></span></button>`).join('')}</div></div>`).join('')}
    <label class="li" style="margin-top:8px"><input id="agree" type="checkbox" style="width:20px;height:20px;accent-color:var(--acc-hi)"><b class="grow" style="font-weight:600">O'qidim va roziman</b></label>
    <button class="btn big" style="margin-top:10px" data-a="sendConsent">Tasdiqlash</button>` : '<p class="mut">Yuklanmoqda…</p>';
  if (cur === 6) body = `<b style="font-size:20px">Arizani yuborish</b><div class="note ok" style="margin-top:10px">${ic('circle-check', 18)}<span>Ma'lumotlar, so'rovnoma, hujjatlar, test va rozilik tayyor.</span></div>
    <p class="mut sm">Tasdiqlangach <b>sinov davri</b> boshlanadi. Reyting 4.5 dan past bo'lsa — ogohlantirish, 4.0 dan past — blok.</p>
    <button class="btn big" data-a="submit">Arizani yuborish</button>`;
  screen(`${title("Ro'yxat", logoutBtn())}${me.status === 'rejected' ? `<div class="note bad" style="margin-bottom:12px">${ic('info', 18)}<span>Ariza rad etildi: ${esc(me.status_reason)}. Tuzatib qayta yuboring.</span></div>` : ''}
    <div class="card">${bar}${body}</div>`, false);
  if (cur === 4 && !S.test) api('GET', '/api/k/test').then((t) => { S.test = t; render(); }).catch((e) => toast(e.message, true));
  if (cur === 5 && !S.cq) api('GET', '/api/onboarding/courier').then((q) => { S.cq = q; S.cans = []; render(); }).catch((e) => toast(e.message, true));
}

// ---------- Ish: liniya, taklif, faol buyurtma ----------
function viewMain() {
  const { me, offer, order } = S.st;
  let html = `<div class="ktop"><button class="ava press" data-a="tab" data-v="profile">${esc(initials(me.name))}</button>
    ${order ? `<span class="toggle on"><i></i>Buyurtmada</span>` : `<button class="toggle press ${me.online ? 'on' : ''}" data-a="online"><i></i>${me.online ? 'Onlayn' : 'Ishga chiqish'}</button>`}
    <button class="earnpill press" data-a="tab" data-v="history"><span>Bugun</span><b>${money(me.earnedToday)}</b></button></div>`;
  const notes = [me.mustSettle && `<div class="note bad">${ic('banknote', 18)}<span>Qo'lingizdagi ${som(me.hand)} naqd 24 soatdan beri topshirilmagan. Topshirmaguningizcha yangi buyurtma kelmaydi.</span></div>`,
    me.rating_warn && `<div class="note warn">${ic('star', 18)}<span>Reytingingiz ${me.rating.toFixed(2)} — 4.5 dan past. 4.0 dan tushsa hisob bloklanadi.</span></div>`,
    me.status === 'probation' && `<div class="note">${ic('award', 18)}<span>Sinov davri: yana <b>${me.probation_left}</b> ta buyurtma.</span></div>`].filter(Boolean);
  if (notes.length) html += `<div class="gap" style="margin-top:14px">${notes.join('')}</div>`;
  if (order) html += `<div style="margin-top:14px">${tripCard(order)}</div>`;
  else {
    html += `<div class="radar ${me.online ? '' : 'off'}"><span class="me">${ic('navigation', 24)}</span></div>
      <div class="wait ${me.online ? '' : 'off'}"><span class="p"></span><span class="col" style="gap:3px"><b style="font-size:16px">${me.online ? 'Buyurtma qidirilmoqda…' : 'Siz oflaynsiz'}</b>
        <span class="mut sm">${me.online ? "Ilovani yopmang. GPS yoqilgan bo'lishi kerak." : "Buyurtma olish uchun onlayn bo'ling"}</span></span></div>`;
  }
  html += `<div class="stats2" style="margin-top:14px">
    <span><span class="mut xs">Qo'lingizdagi naqd</span><b style="${me.hand ? 'color:var(--warn-hi)' : ''}">${som(me.hand)}</b></span>
    <span><span class="mut xs">Naqd limiti</span><b>${som(me.cash_limit)}</b><span class="mut xs">depozit ${money(me.deposit)}</span></span>
    <span><span class="mut xs">Yetkazilgan</span><b>${me.completed}</b></span>
    <span><span class="mut xs">Daraja</span><b style="color:var(--acc-hi)">${esc(me.level)}</b>${me.level_bonus ? `<span class="mut xs">+${money(me.level_bonus)} bonus</span>` : ''}</span></div>
    ${me.next_level ? `<p class="mut xs" style="margin:12px 4px 0">Keyingi daraja — <b>${esc(me.next_level.name)}</b>: ${me.next_level.min} ta buyurtma, reyting ${me.next_level.rating}+, bonus ${money(me.next_level.bonus)}/buyurtma.</p>` : ''}`;
  screen(html);
  if (order) MiniMap.render($('#kmap'), { dark: true,
    points: [{ id: 'place', kind: 'place', lat: order.place.lat, lng: order.place.lng }, { id: 'home', kind: 'home', lat: order.customer.lat, lng: order.customer.lng },
      me.lat != null ? { id: 'me', kind: 'courier', lat: me.lat, lng: me.lng } : null],
    line: ['picked', 'at_customer'].includes(order.courier_status) ? [[order.place.lat, order.place.lng], [order.customer.lat, order.customer.lng]] : me.lat != null ? [[me.lat, me.lng], [order.place.lat, order.place.lng]] : null });
  if (offer && !order) { $('#app').insertAdjacentHTML('beforeend', offerSheet(offer)); tickOffer(); }
}
function offerSheet(o) {
  return `<div class="backdrop"></div><div class="offer">
    <div class="row sb"><span class="col" style="gap:2px"><span class="mut sm" style="font-weight:600">Yangi buyurtma · #${o.id}</span><b class="fee">${som(o.fee)}</b></span>
      <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label="Qolgan vaqt"><circle cx="28" cy="28" r="24" fill="none" stroke="#F2F2F7" stroke-width="5"/>
        <circle id="oring" cx="28" cy="28" r="24" fill="none" stroke="#1D6BFF" stroke-width="5" stroke-linecap="round" stroke-dasharray="${RING}" transform="rotate(-90 28 28)" style="transition:stroke-dashoffset .9s linear"/>
        <text id="otime" x="28" y="33" text-anchor="middle" font-size="14" font-weight="800" fill="#111"></text></svg></div>
    ${o.cash ? `<span class="pill warn" style="align-self:flex-start">${ic('banknote', 14)}Mijozdan naqd: ${som(o.cash)}</span>` : `<span class="pill ok" style="align-self:flex-start">${ic('shield-check', 14)}To'langan — mijoz kelmasa ham haq to'lanadi</span>`}
    <div class="route"><span class="rail"><i></i><s></s><u></u></span><span class="col grow" style="gap:12px">
      <span class="col"><b style="font-size:16px">${esc(o.place)}</b><span class="mut sm">Olish${o.to_place_km != null ? ` · ${kmTxt(o.to_place_km)} sizdan` : ''}${o.place_address ? ' · ' + esc(o.place_address) : ''}</span></span>
      <span class="col"><b style="font-size:16px">${esc(o.address)}</b><span class="mut sm">Yetkazish${o.trip_km != null ? ` · ${kmTxt(o.trip_km)} yo'l` : ''} · ${o.items} ta mahsulot</span></span></span></div>
    <div class="row" style="gap:10px"><button class="btn sec press" data-a="decline" data-id="${o.id}">O'tkazish</button><button class="btn press" data-a="accept" data-id="${o.id}">Qabul qilish</button></div></div>`;
}
function tickOffer() {
  const o = S.st?.offer; if (!o) return;
  const left = Math.max(0, (new Date(o.expires) - Date.now()) / 1000), total = S.offerTotal || 30;
  const t = $('#otime'), r = $('#oring');
  if (t) t.textContent = `${Math.ceil(left)}s`;
  if (r) r.style.strokeDashoffset = String(RING * (1 - Math.min(1, left / total)));
}
setInterval(tickOffer, 1000);

function tripCard(o) {
  const cs = o.courier_status, steps = ['assigned', 'at_restaurant', 'picked', 'at_customer'];
  const idx = steps.indexOf(cs);
  const bar = `<div class="steps">${['Restoran', 'Olish', "Yo'lda", 'Topshirish'].map((l, i) => `<span class="${i <= idx ? 'on' : ''}"><i></i>${l}</span>`).join('')}</div>`;
  const itemsTxt = o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join(', ');
  const info = `<div class="card2 row"><span class="col grow" style="gap:2px"><span class="mut xs">Buyurtma</span><b style="font-size:20px;letter-spacing:1px">#${o.id}</b></span>
    <span class="mut sm" style="text-align:right">${o.items.length} xil mahsulot<br>${o.cash ? `<b style="color:var(--warn-hi)">naqd ${som(o.cash)}</b>` : "to'langan"}</span></div>`;
  const btns = (lat, lng, phone, who) => `<div class="row" style="gap:10px">${lat != null ? `<a class="btn sec press" target="_blank" rel="noopener" href="${mapUrl(lat, lng)}">${ic('navigation', 18)} Yo'l</a>` : ''}
    ${phone ? `<a class="btn sec press" href="tel:+${esc(phone)}" data-a="call" data-id="${o.id}">${ic('phone', 18)} ${who}</a>` : ''}</div>`;
  const release = `<button class="link press" data-a="release" data-id="${o.id}">Voz kechish</button>`;
  let k = '', t = '', a = '', body = '';
  if (cs === 'assigned') { k = 'Restoranga boring'; t = esc(o.place.name); a = esc(o.place.address || '');
    body = `${info}${btns(o.place.lat, o.place.lng, null)}<button class="btn big press" data-a="kact" data-v="arrived_rest" data-id="${o.id}">Restoranga yetib keldim</button>${release}`; }
  if (cs === 'at_restaurant') { k = 'Buyurtmani oling'; t = esc(o.place.name); a = 'Paket yopiq (plombali) ekanini tekshiring';
    body = `${info}<span class="mut sm">${itemsTxt}</span>${o.status === 'ready' ? '' : `<div class="note warn">${ic('timer', 18)}<span>Restoran hali tayyorlamoqda…</span></div>`}
      <button class="btn big press" data-a="pickup" data-id="${o.id}" ${o.status === 'ready' ? '' : 'disabled'}>${ic('scan-face', 20)} Plomba rasmi — oldim</button>${release}`; }
  if (cs === 'picked') { k = 'Mijozga yetkazing'; t = esc(o.customer.address); a = `${esc(o.customer.name || 'Mijoz')} · ${fmtPhone(o.customer.phone)}${o.customer.note ? ' · ' + esc(o.customer.note) : ''}`;
    body = `${info}${btns(o.customer.lat, o.customer.lng, o.customer.phone, 'Mijoz')}<button class="btn big press" data-a="kact" data-v="arrived" data-id="${o.id}">Yetib keldim</button>
      <span class="flabel" style="margin:0 2px -8px">Yoki darhol: mijoz kodi</span><div class="row" style="gap:10px"><input id="kcode" class="inp code grow" inputmode="numeric" maxlength="4" placeholder="····"><button class="btn ok press" style="width:auto" data-a="deliver" data-id="${o.id}">${ic('check', 22, { w: 3 })}</button></div>`; }
  if (cs === 'at_customer') {
    const left = Math.max(0, new Date(o.noshow_at) - Date.now());
    k = 'Topshirish'; t = "Mijozdan 4 xonali kodni so'rang"; a = `${esc(o.customer.address)} · ${esc(o.customer.name || 'Mijoz')}`;
    body = `${info}<input id="kcode" class="inp code" inputmode="numeric" maxlength="4" placeholder="····"><button class="btn big ok press" data-a="deliver" data-id="${o.id}">${ic('check', 20, { w: 3 })} Topshirdim</button>
      ${btns(null, null, o.customer.phone, "Qo'ng'iroq")}
      <details><summary>Mijoz chiqmayaptimi?</summary><div class="card2 col" style="gap:10px;margin-top:8px">
        <span class="sm">1) Qo'ng'iroq qiling ${o.call_at ? '✓' : ''} · 2) Eshik/manzil rasmini oling ${o.door_photo ? '✓' : ''} · 3) 10 daqiqa kuting</span>
        <button class="btn sec sm" data-a="door" data-id="${o.id}">${ic('scan-face', 16)} Eshik rasmi</button>
        <div class="timer" id="nstimer" data-at="${o.noshow_at}">${left ? '' : '00:00'}</div>
        <button class="btn bad" data-a="noshow" data-id="${o.id}">Mijoz olmadi</button>
        <span class="mut xs">Tartib bajarilsa yo'l haqingiz to'lanadi, taom sizda qoladi.</span></div></details>`;
  }
  const hasMap = [o.place.lat, o.customer.lat].some((v) => v != null);
  return `<div class="trip">${hasMap ? '<div id="kmap" class="kmap"></div>' : ''}${bar}<span class="col" style="gap:4px"><span class="k">${k}</span><b class="t">${t}</b><span class="mut sm">${a}</span></span>${body}
    <span class="mut xs" style="text-align:center">Haqingiz: <b style="color:#fff">${som(o.fee)}</b></span></div>`;
}
setInterval(() => { const t = $('#nstimer'); if (!t) return; const l = Math.max(0, new Date(t.dataset.at) - Date.now()); t.textContent = `${String(Math.floor(l / 60000)).padStart(2, '0')}:${String(Math.floor((l % 60000) / 1000)).padStart(2, '0')}`; }, 1000);

// ---------- Daromad ----------
async function viewHistory() {
  const me = S.st.me;
  screen(`${title('Daromad')}<p class="mut">Yuklanmoqda…</p>`);
  const [h, ds] = await Promise.all([api('GET', '/api/k/history').catch(() => ({ orders: [], moves: [] })), api('GET', '/api/k/disputes').catch(() => [])]);
  if (S.tab !== 'history') return;
  const TN = { fee: 'Yetkazish haqi', bonus: 'Bonus', cash: 'Naqd olindi', cash_in: 'Naqd topshirildi', payout: "Sizga to'landi", penalty: 'Jarima', deposit: 'Depozit', note: 'Izoh' };
  // Oxirgi 7 kun daromadi (haq + bonus) — hisob harakatlaridan
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); return d; });
  const DN = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
  const sum = days.map((d) => h.moves.filter((m) => ['fee', 'bonus'].includes(m.type) && new Date(m.at) >= d && new Date(m.at) < new Date(+d + 864e5)).reduce((t, m) => t + m.amount, 0));
  const max = Math.max(1, ...sum), week = sum.reduce((t, v) => t + v, 0);
  const wk = h.orders.filter((o) => new Date(o.delivered_at || o.updated_at) >= days[0]).length;
  const PARTY = { customer: 'Mijoz', restaurant: 'Restoran', courier: 'Siz', platform: 'Platforma', none: 'hech kim' };
  const DST = { open: ["Ko'rib chiqilmoqda", 'warn'], resolved: ['Hal qilindi', 'ok'], rejected: ['Rad etildi', ''] };
  const MEAS = { warn: 'ogohlantirish', fine: 'jarima', block: 'blok', unblock: 'blokdan chiqarildi' };
  screen(`${title('Daromad')}<div class="gap stagger">
    <div class="card col" style="gap:16px"><div class="row sb" style="align-items:flex-end"><span class="col" style="gap:2px"><span class="mut sm" style="font-weight:600">Oxirgi 7 kun</span>
      <b style="font-size:30px;letter-spacing:-.6px">${som(week)}</b></span><span class="mut sm">${wk} ta buyurtma</span></div>
      <div class="bars">${sum.map((v, i) => `<span><i class="${v ? '' : 'z'}" style="height:${Math.max(4, Math.round((v / max) * 120))}px;animation-delay:${i * 50}ms" title="${som(v)}"></i>${i === 6 ? 'Bugun' : DN[days[i].getDay()]}</span>`).join('')}</div></div>
    <div class="stats3"><span><b>${me.completed}</b><span class="mut xs">Yetkazilgan</span></span><span><b>${me.ratings ? '★ ' + me.rating.toFixed(1) : '—'}</b><span class="mut xs">Reyting</span></span>
      <span><b>${money(me.earnedToday)}</b><span class="mut xs">Bugun</span></span></div>
    <div class="stats2"><span><span class="mut xs">Platforma sizga qarzdor</span><b style="color:var(--ok-hi)">${som(Math.max(0, me.balance))}</b></span>
      <span><span class="mut xs">Siz topshirasiz</span><b style="color:var(--warn-hi)">${som(Math.max(0, -me.balance))}</b></span></div>
    <p class="mut xs" style="margin:0 4px">Naqdni har kuni (24 soat ichida) topshiring. Daromad hisob-kitobda to'lanadi.</p>
    <div class="label">Harakatlar</div><div class="card list" style="padding:0 16px">${h.moves.slice(0, 40).map((m) => `<div class="li"><span class="ib">${ic({ deposit: 'wallet', payout: 'wallet', cash: 'banknote', cash_in: 'banknote', penalty: 'info', bonus: 'gift' }[m.type] || 'package', 18)}</span>
      <span class="t"><b>${TN[m.type] || m.type}${m.order_id ? ` · #${m.order_id}` : ''}</b><span>${dt(m.at)} ${esc(m.note)}</span></span><b class="num" style="color:${m.amount < 0 ? 'var(--warn-hi)' : 'var(--ok-hi)'}">${m.amount > 0 ? '+' : ''}${money(m.amount)}</b></div>`).join('') || '<div class="li mut">Hali harakat yo\'q</div>'}</div>
    <div class="label">Buyurtmalar</div><div class="card list" style="padding:0 16px">${h.orders.map((o) => `<div class="li"><span class="t"><b>#${o.id} · ${esc(o.place || '')}</b>
      <span>${dt(o.delivered_at || o.updated_at)} · ${o.status === 'delivered' ? 'yetkazildi' : 'mijoz olmadi'}${o.courier_rating ? ` · ★${o.courier_rating}` : ''}</span></span><b class="num">${money(o.courier_fee)}</b></div>`).join('') || '<div class="li mut">Hali buyurtma yo\'q</div>'}</div>
    <div class="label">Shikoyat va nizolar</div><div class="card list" style="padding:0 16px">${ds.map((d) => `<div class="li" style="align-items:flex-start"><span class="t" style="gap:4px">
      <b>#${d.id}${d.order_id ? ` · buyurtma #${d.order_id}` : ''} · ${PARTY[d.opened_by]}${d.against ? ' → ' + PARTY[d.against] : ''}</b>
      <span>${esc(d.category_name)}: ${esc(d.text)}</span>
      ${d.status !== 'open' ? `<span style="color:#D4D4D8">Qaror: aybdor — ${PARTY[d.guilty] || '—'}${d.measure ? `, ${MEAS[d.measure]}` : ''}${d.recover && d.appeal_status !== 'accepted' ? `, undirildi ${som(d.recover)}` : ''}. ${esc(d.resolution)}${d.guilty !== 'courier' ? '' : d.appeal_status === 'accepted' ? " E'tirozingiz qabul qilindi." : d.appeal_status === 'rejected' ? " E'tiroz rad etildi." : ''}</span>` : ''}
      <span class="row" style="gap:6px;margin-top:4px"><span class="pill ${DST[d.status]?.[1] || ''}">${d.appeal_status === 'open' ? "E'tiroz ko'rilmoqda" : DST[d.status]?.[0] || d.status}</span>
        ${d.status === 'open' || d.appeal_status === 'open' ? `<button class="btn sm sec" data-a="dNote" data-id="${d.id}">Javob</button>` : ''}${d.can_appeal ? `<button class="btn sm" data-a="dAppeal" data-id="${d.id}">E'tiroz</button>` : ''}</span></span></div>`).join('') || '<div class="li mut">Nizo yo\'q</div>'}</div>
    ${h.orders.length ? `<details class="card"><summary>Muammo bildirish (restoran yoki mijoz)</summary><div class="col" style="gap:10px;margin-top:10px">
      <select id="dOrder" class="inp">${h.orders.map((o) => `<option value="${o.id}">#${o.id} · ${esc(o.place || '')}</option>`).join('')}</select>
      <select id="dAgainst" class="inp"><option value="restaurant">Restoranga</option><option value="customer">Mijozga</option></select>
      <select id="dCat" class="inp"><option value="restaurant_delay">Restoran kechiktirdi</option><option value="damaged">Paket ochiq / shikastlangan edi</option><option value="customer_abuse">Mijoz bilan muammo</option><option value="payment">To'lov / naqd muammosi</option><option value="other">Boshqa</option></select>
      <textarea id="dText" class="inp" rows="2" maxlength="1000" placeholder="Nima bo'ldi?"></textarea><button class="btn" data-a="dOpen">Yuborish</button></div></details>` : ''}</div>`);
}

// ---------- Profil ----------
function viewProfile() {
  const me = S.st.me;
  const vehicle = (VEH.find((v) => v[0] === me.vehicle) || [, me.vehicle || '—'])[1];
  const RULES = [['package', 'Olish', 'Faqat yopiq (plombali) paketni oling va rasmini ilovada oling.'], ['shield-check', 'Topshirish', "Mijozdan 4 xonali kodni so'rang. Kodsiz bermang."],
    ['timer', 'Mijoz chiqmasa', "Qo'ng'iroq, eshik rasmi, 10 daqiqa kutish — keyin «Mijoz olmadi». Yo'l haqingiz to'lanadi."], ['banknote', 'Naqd', "Olgan naqdni 24 soat ichida topshiring. Limit depozit va darajaga bog'liq."],
    ['star', 'Reyting', "4.5 dan past — ogohlantirish, 4.0 dan past — blok. E'tiroz huquqingiz bor."], ['award', 'Darajalar', 'Yangi → Bronza (20, 4.5+) → Kumush (100, 4.7+) → Oltin (300, 4.85+). Bonus va limit oshadi.'],
    ['route', 'Voz kechish', 'Faqat restorandan olishdan oldin mumkin va hisobga olinadi.']];
  screen(`${title('Profil')}<div class="gap stagger">
    <div class="card col" style="gap:14px"><div class="row" style="gap:14px"><span class="ava lg">${esc(initials(me.name))}${me.myid_verified ? `<span class="ok">${ic('check', 11, { w: 4 })}</span>` : ''}</span>
      <span class="col" style="gap:3px"><b style="font-size:18px">${esc(me.name || 'Kuryer')}</b><span class="sm" style="color:${me.status === 'active' ? 'var(--ok-hi)' : 'var(--warn-hi)'};font-weight:600">${me.status === 'active' ? 'Tasdiqlangan kuryer' : 'Sinov davri'} · ID ${me.id}</span>
        <span class="mut xs">${fmtPhone(me.phone)}</span></span></div>
      <div class="stats3"><span><b>${me.ratings ? '★ ' + me.rating.toFixed(1) : '—'}</b><span class="mut xs">Reyting</span></span><span><b>${me.completed}</b><span class="mut xs">Yetkazish</span></span>
        <span><b style="color:var(--acc-hi)">${esc(me.level)}</b><span class="mut xs">Daraja</span></span></div></div>
    <div class="card list" style="padding:0 16px">
      <div class="li"><span class="ib">${ic('id-card', 18)}</span><span class="t"><b>Shaxs (MyID)</b><span>${me.myid_verified ? 'Tasdiqlangan' : 'Platforma tekshiradi'}</span></span><span class="pill ${me.myid_verified ? 'ok' : 'warn'}">${me.myid_verified ? 'Tasdiqlangan' : 'Kutilmoqda'}</span></div>
      ${DOCS.filter(([k]) => me.docs.includes(k)).map(([, n, i]) => `<div class="li"><span class="ib">${ic(i, 18)}</span><span class="t"><b>${n.replace(' (ixtiyoriy)', '')}</b><span>Yuklangan</span></span><span class="pill ok">✓</span></div>`).join('')}
      <div class="li"><span class="ib">${ic('bike', 18)}</span><span class="t"><b>Transport</b><span>${esc(vehicle)}${me.vehicle_no ? ' · ' + esc(me.vehicle_no) : ''}</span></span></div></div>
    <div class="label">Qoidalar</div><div class="card list" style="padding:0 16px">${RULES.map(([i, h, p]) => `<div class="li" style="align-items:flex-start"><span class="ib">${ic(i, 18)}</span><span class="t"><b>${h}</b><span style="color:#D4D4D8;font-size:13px">${p}</span></span></div>`).join('')}</div>
    <div class="card list" style="padding:0 16px">
      <a class="li press" href="${esc(DX.asset('/legal/privacy'))}" target="_blank" rel="noopener" style="color:#fff"><span class="ib">${ic('shield-check', 18)}</span><b class="grow" style="font-weight:600">Maxfiylik siyosati</b>${ic('chevron-right', 18, { c: '#52525B' })}</a>
      <a class="li press" href="${esc(DX.asset('/legal/terms'))}" target="_blank" rel="noopener" style="color:#fff"><span class="ib">${ic('book-open', 18)}</span><b class="grow" style="font-weight:600">Foydalanish shartlari</b>${ic('chevron-right', 18, { c: '#52525B' })}</a>
      <button class="li press" data-a="logout" style="color:var(--bad-hi)"><span class="ib" style="color:var(--bad-hi)">${ic('log-out', 18)}</span><b class="grow" style="font-weight:600">Chiqish</b></button></div>
    <details class="card"><summary>Akkauntni o'chirish</summary><div class="col" style="gap:10px;margin-top:10px">
      <span class="mut sm">Ism, telefon, hujjat rasmlari va joylashuv o'chiriladi. Hisobingizda naqd, daromad yoki depozit qolgan bo'lsa — so'rov qabul qilinadi va platforma hisob-kitobdan keyin o'chiradi. ${legalLink('delete', 'Batafsil')}</span>
      <button class="btn sec" data-a="delOtp">SMS kod olish</button>
      <div id="ds2" hidden><input id="dcode" class="inp otp" inputmode="numeric" maxlength="5" placeholder="SMS kod">
        <button class="btn bad" style="margin-top:10px" data-a="delConfirm">Akkauntni o'chirish</button><div id="ddev" class="devcode"></div></div></div></details></div>`);
}

// ---------- Harakatlar ----------
// So'rovnoma maydonlarini qayta chizishdan oldin saqlab qo'yamiz
const keepQ = () => { const q = S.q || (S.q = { availability: [] }); if ($('#by')) q.birth_year = $('#by').value; if ($('#dist')) q.district = $('#dist').value; if ($('#gps')) q.smartphone_gps = $('#gps').checked; };
const radioOn = (el) => el.parentElement.querySelectorAll(`[data-a="${el.dataset.a}"]`).forEach((b) => b.classList.toggle('on', b === el));
const A = {
  otp: async (el) => {
    const phone = $('#ph').value; el.disabled = true;
    const r = await run(() => api('POST', '/api/k/otp', { phone }));
    if (!r) { el.disabled = false; return; }
    setTimeout(() => { el.disabled = false; }, 60000);
    store.set('dx_kphone', phone); $('#s2').hidden = false; el.className = 'btn sec'; el.textContent = 'Kodni qayta olish (1 daqiqadan keyin)';
    if (r.dev_code) $('#dev').textContent = `Sinov rejimi: kod — ${r.dev_code}`; $('#code').focus();
  },
  login: async () => {
    const r = await run(() => api('POST', '/api/k/login', { phone: $('#ph').value, code: $('#code').value }));
    if (!r) return; S.token = r.token; store.set('dx_ktoken', r.token); await refresh(); startPoll();
  },
  delOtp: async (el) => {
    el.disabled = true;
    const r = await run(() => api('POST', '/api/k/otp', { phone: S.st.me.phone }));
    setTimeout(() => { el.disabled = false; }, 60000);
    if (!r) { el.disabled = false; return; }
    $('#ds2').hidden = false; if (r.dev_code) $('#ddev').textContent = `Sinov rejimi: kod — ${r.dev_code}`; $('#dcode').focus();
  },
  delConfirm: async () => {
    if (!confirm("Akkaunt o'chiriladi. Davom etamizmi?")) return;
    const r = await run(() => api('POST', '/api/account/delete', { kind: 'courier', phone: S.st.me.phone, code: $('#dcode').value }));
    if (!r) return;
    toast(r.message); S.token = null; S.st = null; store.set('dx_ktoken', null); stopGeo(); render();
  },
  logout: async () => { if (!confirm('Akkauntdan chiqamizmi?')) return; await api('POST', '/api/k/logout').catch(() => {}); S.token = null; S.st = null; store.set('dx_ktoken', null); stopGeo(); render(); },
  tab: (el) => { S.tab = el.dataset.v; window.scrollTo(0, 0); render(); },
  veh: (el) => { S.veh = el.dataset.v; radioOn(el); $('#vnb').hidden = !['moto', 'avto'].includes(S.veh); },
  saveProfile: async () => {
    const r = await run(() => api('POST', '/api/k/profile', { name: $('#nm').value, vehicle: S.veh || S.st.me.vehicle, vehicle_no: $('#vno')?.value }));
    if (r) { S.st.me = { ...S.st.me, ...r }; S.regStep = null; render(); }
  },
  regStep: (el) => { S.regStep = Number(el.dataset.v); render(); },
  doc: async (el) => {
    const d = await pickPhoto(); if (!d) return;
    const r = await run(() => api('POST', '/api/k/docs', { kind: el.dataset.v, data: d }));
    if (r) { S.st.me = r; toast('Yuklandi'); render(); }
  },
  ans: (el) => { S.answers[Number(el.dataset.q)] = Number(el.dataset.v); radioOn(el); },
  sendTest: async () => {
    if (S.answers.filter((x) => x != null).length < S.test.length) return toast('Hamma savolga javob bering', true);
    const r = await run(() => api('POST', '/api/k/test', { answers: S.answers }));
    if (!r) return;
    if (r.passed) { toast(`Testdan o'tdingiz: ${r.score}/${r.total}`); S.regStep = null; } else toast(`${r.score}/${r.total} — o'tmadi. Xato savollar: ${r.wrong.map((i) => i + 1).join(', ')}. 10 daqiqadan keyin qayta urining`, true);
    S.answers = []; S.force = true; await refresh();
  },
  // So'rovnoma va rozilik (onboarding.ts)
  slot: (el) => { const q = S.q; keepQ(); const k = el.dataset.v; q.availability = q.availability.includes(k) ? q.availability.filter((x) => x !== k) : [...q.availability, k]; render(); },
  exp: (el) => { keepQ(); S.q.experience = el.dataset.v === 'yes'; render(); },
  saveApp: async () => {
    keepQ(); const q = S.q;
    const r = await run(() => api('POST', '/api/k/application', { birth_year: Number(q.birth_year) || 0, district: q.district, availability: q.availability, experience: !!q.experience, smartphone_gps: !!q.smartphone_gps }));
    if (r) { S.regStep = null; S.force = true; toast("So'rovnoma saqlandi"); await refresh(); }
  },
  cans: (el) => { S.cans[Number(el.dataset.q)] = Number(el.dataset.v); radioOn(el); },
  sendConsent: async () => {
    if (S.cans.filter((x) => x != null).length < S.cq.questions.length) return toast('Hamma savolga javob bering', true);
    if (!$('#agree').checked) return toast("«O'qidim va roziman» ni belgilang", true);
    const r = await run(() => api('POST', '/api/k/consent', { answers: S.cans, agree: true }));
    if (!r) return;
    if (!r.passed) return toast(`Xato javob: ${r.wrong.map((i) => i + 1).join(', ')}-savol. Qoidalarni qayta o'qing`, true);
    toast('Rahmat! Rozilik qayd etildi'); S.regStep = null; S.force = true; await refresh();
  },
  submit: async () => { const r = await run(() => api('POST', '/api/k/submit')); if (r) { S.regStep = null; S.force = true; await refresh(); } },
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
    if (!confirm('Mijoz buyurtmani olmadi deb belgilaymizmi? Taom sizda qoladi.')) return;
    const r = await run(() => api('POST', `/api/k/orders/${el.dataset.id}/noshow`));
    if (r) toast(`Belgilandi. Yo'l haqingiz +${som(r.fee)}`); refresh();
  },
  // 8-etap: nizolar
  dNote: async (el) => { const text = prompt('Javobingiz (isbot, tushuntirish):'); if (text && (await run(() => api('POST', `/api/k/disputes/${el.dataset.id}/note`, { text })))) { toast('Yuborildi'); render(); } },
  dAppeal: async (el) => { const text = prompt("E'tirozingizni yozing (faqat bir marta):"); if (text && (await run(() => api('POST', `/api/k/disputes/${el.dataset.id}/appeal`, { text })))) { toast("E'tiroz yuborildi"); render(); } },
  dOpen: async () => {
    const text = $('#dText').value.trim(); if (text.length < 3) return toast('Muammoni yozing', true);
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
