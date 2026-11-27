// FastHub Uz — mijoz ilovasi: profil, kirish (SMS kod), akkauntni o'chirish (FastHub prototipi dizayni).
'use strict';

// Huquqiy sahifalar serverda (/legal/*) — ilovada to'liq manzil bilan tashqi brauzerda ochiladi
const legalUrl = (page) => DX.asset('/legal/' + page);
const legalLink = (page, text) => `<a href="${esc(legalUrl(page))}" target="_blank" rel="noopener">${text}</a>`;
const serverUrl = (path) => (DX.native && DX.base ? DX.base : '') + path; // /#register, /courier/ — server sahifalari

async function viewMe() {
  if (!S.token) return page(`<div class="pad"><h1 class="h1" style="margin-bottom:16px">Profil</h1>
    ${emptyBox('user', 'Xush kelibsiz!', "Buyurtma berish va kuzatish uchun telefon raqamingiz bilan kiring", `<button class="btn" style="width:220px" data-a="tologin" data-v="#me">Kirish</button>`)}</div>
    ${partnerCards()}${legalList()}`, { tab: '#me' });
  page(`<div class="pad"><h1 class="h1">Profil</h1></div><div id="me">${loading()}</div>`, { tab: '#me' });
  const [me, list, legal] = await Promise.all([api('GET', '/api/c/me').catch(() => null), api('GET', '/api/c/orders').catch(() => []), api('GET', '/api/legal').catch(() => ({}))]);
  if (!me) { S.after = '#me'; return go('#login'); }
  S.me = me; setOrders(list);
  if (!$('#me')) return;
  const act = list.filter((o) => ACTIVE.includes(o.status)).length;
  $('#me').innerHTML = `<div class="col stagger" style="gap:14px;margin-top:14px">
    <div class="card col" style="margin:0 16px;padding:16px;gap:14px">
      <button class="row press" data-a="rename"><span class="ava acc" style="width:58px;height:58px;border-radius:29px;font-size:20px">${esc(initials(me.name || 'FH'))}</span>
        <span class="col grow" style="gap:2px"><b style="font-size:18px">${esc(me.name || 'Ismingizni kiriting')}</b><span class="mut" style="font-size:14px">${fmtPhone(me.phone)}</span></span>${ic('chevron-right', 18, { c: '#C7C7CC' })}</button>
      <div class="stats3"><span><b>${me.completed}</b><span class="mut xs">Yetkazilgan</span></span><span class="${act ? 'acc' : ''}"><b>${act}</b><span class="mut xs">Faol buyurtma</span></span>
        <span><b>${me.debt ? money(me.debt) : '0'}</b><span class="mut xs">Qarz, so'm</span></span></div></div>
    ${me.debt ? `<div class="note warn" style="margin:0 16px">${ic('info', 18)}<span>Oldingi olinmagan buyurtma uchun ${som(me.debt)} keyingi buyurtmaga qo'shiladi.</span></div>` : ''}
    <div class="card grid4" style="margin:0 16px">
      ${[['#orders', 'Buyurtmalar', 'receipt-text', '#FFF1EA', '#C2410C'], ['#cart', 'Savat', 'shopping-cart', '#E8F7EE', '#15803D'], ['#', 'Joylar', 'store', '#E9EEFF', '#3346E8']]
        .map(([h, l, i, bg, fg]) => `<button class="press" data-a="go" data-v="${h}"><i style="background:${bg}">${ic(i, 24, { c: fg, w: 1.9 })}</i>${l}</button>`).join('')}
      ${legal.phone ? `<a class="press" href="tel:${esc(legal.phone.replace(/[^\d+]/g, ''))}"><i style="background:#EFEFF4">${ic('life-buoy', 24, { c: '#3A3A40', w: 1.9 })}</i>Yordam</a>` : ''}</div>
    ${partnerCards()}
    <div class="card list" style="margin:0 16px">
      <button class="li press" data-a="logout" style="color:var(--bad)">${ic('log-out', 20)}<b class="grow" style="font-weight:600">Chiqish</b></button>
      <button class="li press" data-a="go" data-v="#delete">${ic('x', 20, { c: 'var(--mut)' })}<b class="grow mut" style="font-weight:600">Akkauntni o'chirish</b>${ic('chevron-right', 18, { c: '#C7C7CC' })}</button></div>
    ${legalList()}</div>`;
}
const partnerCards = () => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 16px 0">
  ${[['store', "Biznesingizni qo'shing", "Restoran, do'kon, dorixona", '/#register'], ['bike', "Kuryer bo'ling", 'Qulay vaqtda ishlang', '/courier/']].map(([i, a, b, path]) => `
    <a class="card col press" style="padding:14px;gap:6px;color:var(--ink)" href="${esc(serverUrl(path))}" target="_blank" rel="noopener">${ic(i, 24, { c: 'var(--acc)' })}<b style="font-size:15px">${a}</b><span class="mut xs">${b}</span></a>`).join('')}</div>`;
const legalList = () => `<div class="card list" style="margin:14px 16px 0">
  ${[['privacy', 'Maxfiylik siyosati', 'shield-check'], ['terms', 'Foydalanish shartlari', 'book-open']].map(([p, n, i]) => `<a class="li press" href="${esc(legalUrl(p))}" target="_blank" rel="noopener" style="color:var(--ink)">
    ${ic(i, 20, { c: 'var(--mut)' })}<b class="grow" style="font-weight:600">${n}</b>${ic('chevron-right', 18, { c: '#C7C7CC' })}</a>`).join('')}</div>
  <p class="mut xs" style="text-align:center;margin:14px">FastHub Uz</p>`;

function viewLogin() {
  const back = S.after && S.after !== '#login' ? S.after : '#';
  page(`${head(['#orders', '#me', '#cart'].includes(back) ? back : '#', '')}<div class="pad"><h1 class="h1">Kirish</h1>
      <p class="mut" style="margin:6px 0 0">Buyurtma holati va kuryer siz bilan shu raqam orqali bog'lanadi.</p></div>
    <div class="card" style="margin:18px 16px 0;padding:16px">
      <span class="flabel" style="margin-top:0">Telefon raqam</span><input id="ph" class="inp" type="tel" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(store.get('dx_phone') || '')}">
      <button class="btn press" style="margin-top:12px" data-a="otp">Kod olish</button>
      <div id="step2" hidden><span class="flabel">SMS kod</span><input id="code" class="inp otp" inputmode="numeric" maxlength="5" autocomplete="one-time-code">
        <span class="flabel">Ismingiz</span><input id="nm" class="inp" maxlength="60" placeholder="Masalan: Javohir">
        <button class="btn press" style="margin-top:12px" data-a="login">Kirish</button><div id="dev" class="devcode"></div></div></div>
    <p class="mut sm" style="margin:14px 24px;text-align:center">Kirish orqali ${legalLink('terms', 'foydalanish shartlari')} va ${legalLink('privacy', 'maxfiylik siyosati')}ga rozilik bildirasiz.</p>`);
}

async function viewDelete() {
  if (S.token && !S.me) S.me = await api('GET', '/api/c/me').catch(() => null);
  if (!S.token || !S.me) { S.after = '#delete'; return go('#login'); }
  page(`${head('#me', '')}<div class="pad"><h1 class="h1">Akkauntni o'chirish</h1></div>
    <div class="card" style="margin:16px 16px 0;padding:16px">
      <p class="mut" style="margin:0 0 12px;font-size:14px">Ismingiz, telefon raqamingiz, manzillaringiz va kirish ma'lumotlari o'chiriladi. Buyurtmalar summasi buxgalteriya uchun ismsiz saqlanadi.
        Faol buyurtma, ochiq shikoyat yoki kutilayotgan pul qaytarish bo'lsa — ular yakunlangach o'chiring. Bu amalni qaytarib bo'lmaydi.</p>
      <div class="row sb" style="margin-bottom:12px"><span class="mut">Raqam</span><b>${fmtPhone(S.me.phone)}</b></div>
      <button class="btn sec press" data-a="delOtp">SMS kod olish</button>
      <div id="step2" hidden><span class="flabel">SMS kod</span><input id="dcode" class="inp otp" inputmode="numeric" maxlength="5" autocomplete="one-time-code">
        <button class="btn bad press" style="margin-top:12px" data-a="delConfirm">Akkauntni butunlay o'chirish</button><div id="dev" class="devcode"></div></div></div>
    <p class="sm" style="margin:14px 24px;text-align:center">${legalLink('delete', "Batafsil: nima o'chiriladi va nima saqlanadi")}</p>`);
}
