// FastHub Uz — mijoz ilovasi: buyurtmalar ro'yxati, buyurtmani kuzatish, to'lov, shikoyat (FastHub prototipi dizayni).
'use strict';

async function viewOrders() {
  if (!S.token) return page(`<div class="pad"><h1 class="h1" style="margin-bottom:16px">Buyurtmalar</h1>
    ${emptyBox('receipt-text', 'Kirish kerak', "Buyurtmalaringizni ko'rish uchun telefon raqam bilan kiring", `<button class="btn" style="width:220px" data-a="tologin" data-v="#orders">Kirish</button>`)}</div>`, { tab: '#orders' });
  page(`<div class="pad"><h1 class="h1">Buyurtmalar</h1></div><div id="olist">${loading()}</div>`, { tab: '#orders' });
  const list = await run(() => api('GET', '/api/c/orders'));
  if (!list || !$('#olist')) return;
  setOrders(list);
  const act = list.filter((o) => ACTIVE.includes(o.status)), old = list.filter((o) => !ACTIVE.includes(o.status));
  const qty = (o) => o.items.reduce((t, i) => t + (i.weight_g ? 1 : i.qty), 0);
  $('#olist').innerHTML = `${act.length ? `<div class="pad col stagger" style="gap:10px;margin-top:16px">${act.map((o) => `<button class="card ocard press live" data-a="go" data-v="#order/${o.id}">
      <span class="ic-b">${ic(o.status === 'on_way' ? 'bike' : o.status === 'awaiting_payment' ? 'credit-card' : 'flame', 22)}</span>
      <span class="col grow" style="gap:2px"><b>${ST[o.status][0]}</b><span class="mut sm">${esc(o.place)} · #${o.id} · ${som(o.total)}</span></span>${ic('chevron-right', 18, { c: '#C7C7CC' })}</button>`).join('')}</div>`
    : `<div class="pad" style="margin-top:16px">${emptyBox('receipt-text', "Faol buyurtma yo'q", "Buyurtma bersangiz, shu yerda jonli kuzatasiz", `<button class="btn" style="width:220px" data-a="go" data-v="#">Tanlashga o'tish</button>`)}</div>`}
    ${old.length ? `<div class="label">Tarix</div><div class="card list stagger" style="margin:0 16px">${old.map((o) => `<button class="li press" data-a="go" data-v="#order/${o.id}">
      <span class="t"><b>${esc(o.place)}</b><span>${dt(o.created_at)} · #${o.id} · ${qty(o)} ta</span></span>
      <span class="col" style="align-items:flex-end;gap:3px"><b class="num">${money(o.total)}</b><span class="pill ${ST[o.status]?.[1] || ''}" style="height:22px">${esc(ST[o.status]?.[0] || o.status)}</span></span></button>`).join('')}</div>` : ''}`;
}

function progress(o) {
  const pick = o.mode === 'pickup';
  const labels = pick ? ['Tasdiq', 'Tayyorlash', 'Tayyor', 'Olindi'] : ['Tasdiq', 'Tayyorlash', "Yo'lda", 'Yetkazildi'];
  const step = { awaiting_payment: 0, new: 0, accepted: 1, ready: 2, on_way: 2, delivered: 4 }[o.status] ?? -1;
  if (step < 0) return '';
  const fill = (i) => (i < step ? 1 : i === step ? (pick && step === 2 ? 1 : 0.5) : 0);
  return `<div class="prog">${labels.map((l, i) => `<span class="${i <= step ? 'on' : ''}"><i style="--p:${fill(i)}"></i>${l}</span>`).join('')}</div>`;
}
function courierCard(o) {
  const c = o.courier;
  if (!c || !['accepted', 'ready', 'on_way'].includes(o.status)) return '';
  if (c.status === 'searching') return `<div class="who" style="margin-top:16px"><span class="ava">${ic('bike', 22)}</span><span class="col grow"><b>Kuryer qidirilmoqda…</b><span class="mut sm">Yaqin atrofdagi kuryerga taklif yuborildi</span></span></div>`;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const d = c.lat != null && o.lat != null ? 2 * R * Math.asin(Math.sqrt(Math.sin(rad(o.lat - c.lat) / 2) ** 2 + Math.cos(rad(c.lat)) * Math.cos(rad(o.lat)) * Math.sin(rad(o.lng - c.lng) / 2) ** 2)) : null;
  const CS = { assigned: 'restoranga ketmoqda', at_restaurant: 'restoranda', picked: 'sizga kelmoqda', at_customer: 'eshigingiz oldida' };
  return `<div class="who" style="margin-top:16px;animation:pop .5s var(--ios)"><span class="ava">${esc(initials(c.name))}</span>
    <span class="col grow" style="gap:2px"><b>${esc(c.name)}</b><span class="mut sm row" style="gap:4px">${ic('star', 13, { c: 'var(--star)', fill: 'var(--star)' })}${c.rating ?? '—'} · ${esc(c.vehicle || '')} ${esc(c.vehicle_no || '')}</span>
      <span class="mut xs">${CS[c.status] || ''}${d != null ? ` · ${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'}` : ''}</span></span>
    ${c.lat != null ? `<a class="circle press" target="_blank" rel="noopener" href="https://yandex.uz/maps/?pt=${c.lng},${c.lat}&z=16&l=map" aria-label="Xaritada">${ic('map', 20)}</a>` : ''}
    <a class="circle press" style="background:var(--acc);color:#fff" href="tel:+${esc(c.phone)}" aria-label="Qo'ng'iroq">${ic('phone', 20)}</a></div>`;
}

async function viewOrder(id, silent) {
  const o = await (silent ? api('GET', '/api/c/orders/' + id).catch(() => null) : run(() => api('GET', '/api/c/orders/' + id)));
  if (!o) return silent ? null : go('#orders');
  if (location.hash !== '#order/' + id) return;
  const st = ST[o.status] || [o.status, ''];
  const eta = o.accepted_at && o.prep_minutes && ['accepted', 'ready', 'on_way'].includes(o.status) ? hhmm(new Date(new Date(o.accepted_at).getTime() + (o.prep_minutes + 20) * 60000).toISOString()) : '';
  const payNote = { paid: ['ok', 'circle-check', `Onlayn to'langan: ${som(o.paid_amount)}`], refund_due: ['warn', 'info', `To'langan ${som(o.paid_amount)} qaytariladi. Platforma siz bilan bog'lanadi.`],
    refunded: ['ok', 'circle-check', "To'lov qaytarildi"], pending: ['warn', 'credit-card', "To'lov kutilmoqda"] }[o.payment_status];
  const cash = o.total - (o.payment_status === 'paid' ? o.paid_amount : 0);
  const prep = o.prep_minutes || 30; // tasdiqlanmagan buyurtma: tayyorlash + yo'l vaqti oralig'i
  const big = o.status === 'delivered' ? (o.mode === 'pickup' ? 'Olib ketildi' : 'Yetkazildi') : eta ? `~${eta} da` : ['new', 'awaiting_payment'].includes(o.status) ? `${prep + 10}–${prep + 25} daq` : st[0];
  const changes = o.changes ? JSON.parse(o.changes) : [];
  page(`${head('#orders', `Buyurtma #${o.id}`)}
    <div class="card status" style="margin:0 16px;padding-bottom:18px">
      <div class="row sb" style="align-items:flex-end"><span class="col" style="gap:4px"><span class="mut sm">${o.status === 'delivered' ? 'Yoqimli ishtaha!' : eta || ['new', 'awaiting_payment'].includes(o.status) ? 'Taxminiy vaqt' : esc(o.place)}</span><b class="eta">${big}</b></span>
        <span class="pill ${st[1]}" style="flex:0 0 auto">${ACTIVE.includes(o.status) ? '<span class="dot"></span>' : ''}${esc(st[0])}</span></div>
      ${progress(o)}
      ${o.reject_reason ? `<div class="note bad" style="margin-top:14px">${ic('info', 18)}<span>Sabab: ${esc(o.reject_reason)}</span></div>` : ''}
      ${courierCard(o) || (ACTIVE.includes(o.status) ? `<div class="who" style="margin-top:16px"><span class="ph" style="width:48px;height:48px;border-radius:14px;${bgImg(coverUrl(o.place_type))}"></span>
        <span class="col grow"><b>${esc(o.place)}</b><span class="mut sm">${o.status === 'new' ? 'Buyurtmani tasdiqlamoqda' : o.status === 'awaiting_payment' ? "To'lovni kutmoqda" : 'Tayyorlamoqda'}</span></span></div>` : '')}</div>
    ${o.handover_code ? `<div class="card" style="margin:14px 16px 0;padding:16px;text-align:center"><span class="mut sm">Kuryerga shu kodni ayting — kodsiz buyurtma berilmaydi</span><div class="hcode">${esc(o.handover_code)}</div></div>` : ''}
    ${o.status === 'awaiting_payment' ? `<div class="pad" style="margin-top:14px"><button class="btn press" data-a="go" data-v="#pay/${o.id}">${ic('credit-card', 20)}To'lovni yakunlash · ${som(o.prepay_amount)}</button></div>` : ''}
    ${o.can_rate ? `<div class="card col" style="margin:14px 16px 0;padding:16px;gap:10px;align-items:center"><b>Kuryerni baholang</b>
      <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-a="star" data-v="${n}" class="${S.stars >= n ? 'on' : ''}" aria-label="${n} yulduz">${ic('star', 34, { fill: 'currentColor', c: 'currentColor' })}</button>`).join('')}</div>
      <input id="rcm" class="inp" maxlength="300" placeholder="Izoh (ixtiyoriy)"><button class="btn press" data-a="rate" data-id="${o.id}">Yuborish</button></div>` : ''}
    <div class="label">Tarkibi</div>
    <div class="card col" style="margin:0 16px;padding:12px 16px;gap:8px;font-size:15px">
      ${o.items.map((i) => `<div class="row sb"><span>${i.weight_g ? kgTxt(i.weight_g) : i.qty + ' ×'} ${esc(i.name)}</span><span class="mut num">${money(i.weight_g ? Math.round((i.price * i.weight_g) / 1000) : (i.price + (i.mod_price || 0)) * i.qty)}</span></div>`).join('')}
      <div class="row sb mut"><span>${o.mode === 'pickup' ? 'Olib ketish' : 'Yetkazish'}</span><span>${o.delivery_fee ? money(o.delivery_fee) : 'Bepul'}</span></div>
      ${o.debt_amount ? `<div class="row sb mut"><span>Oldingi qarz</span><span>${money(o.debt_amount)}</span></div>` : ''}
      <div class="row sb" style="font-weight:800;border-top:.5px solid var(--line);padding-top:8px"><span>Jami</span><span>${som(o.total)}</span></div>
      ${payNote ? `<div class="note ${payNote[0]}">${ic(payNote[1], 18)}<span>${esc(payNote[2])}</span></div>` : ''}
      ${cash > 0 && ACTIVE.includes(o.status) && o.status !== 'awaiting_payment' ? `<span class="mut sm">Kuryerga naqd: <b>${som(cash)}</b></span>` : ''}</div>
    ${changes.length ? `<div class="label">Do'kon o'zgartirdi</div><div class="card" style="margin:0 16px;padding:12px 16px">${changes.map((x) => `<div class="sm">• ${esc(x)}</div>`).join('')}
      ${o.refund_amount ? `<div class="note warn" style="margin-top:8px">${som(o.refund_amount)} qaytariladi</div>` : ''}</div>` : ''}
    <div class="card list" style="margin:14px 16px 0"><div class="li">${ic(o.mode === 'pickup' ? 'store' : 'map-pin', 20, { c: 'var(--acc)' })}<span class="t"><span>${o.mode === 'pickup' ? 'Olib ketish joyi' : 'Manzil'}</span><b>${esc(o.mode === 'pickup' ? o.place : o.address)}</b></span></div>
      ${o.note ? `<div class="li">${ic('message-circle', 20, { c: 'var(--acc)' })}<span class="t"><span>Izoh</span><b>${esc(o.note)}</b></span></div>` : ''}</div>
    ${claimBox(o)}
    ${['awaiting_payment', 'new'].includes(o.status) ? `<div class="pad" style="margin-top:14px"><button class="btn bad press" data-a="ocancel" data-id="${o.id}">Buyurtmani bekor qilish</button></div>` : ''}`, { keep: silent });
  return o;
}

// ---------- To'lov (sinov) ----------
async function viewPay(id) {
  const o = await run(() => api('GET', '/api/c/orders/' + id));
  if (!o) return go('#orders');
  if (o.status !== 'awaiting_payment') return go('#order/' + id);
  page(`${head('#order/' + id, "To'lov")}<div class="card col" style="margin:0 16px;padding:24px 20px;gap:12px;align-items:center;text-align:center">
      ${payLogo(o.payment_provider || 'test')}<span class="mut">To'lov summasi</span><b style="font-size:34px;letter-spacing:-.8px">${som(o.prepay_amount)}</b><span class="mut sm">${esc(o.place)} · buyurtma #${o.id}</span>
      <div class="note warn" style="text-align:left">${ic('info', 18)}<span>Sinov to'lovi. Haqiqiy Click/Payme ulanganda to'lov tizimi sahifasi ochiladi.</span></div>
      <button class="btn press" data-a="testpay" data-id="${o.id}">${ic('shield-check', 20)}Tasdiqlash</button>
      <button class="btn bad press" data-a="ocancel" data-id="${o.id}">Bekor qilish</button>
      <span class="mut xs">To'lanmagan buyurtma 30 daqiqadan keyin avtomatik bekor bo'ladi.</span></div>`);
}

// ---------- Shikoyat ----------
const CLAIM_CAT = [['missing', 'Taom yetishmaydi'], ['wrong', 'Boshqa taom keldi'], ['damaged', 'Paket ochilgan / shikastlangan'], ['cold', 'Taom sovuq / sifatsiz'], ['late', 'Juda kech keldi'],
  ['not_delivered', 'Buyurtma kelmadi'], ['rude', "Qo'pol muomala"], ['payment', "To'lov muammosi"], ['other', 'Boshqa']];
const CLAIM_ST = { open: ["Ko'rib chiqilmoqda", 'warn'], resolved: ['Hal qilindi', 'ok'], rejected: ['Rad etildi', 'bad'] };
function claimBox(o) {
  const c = o.claim;
  if (!c) return o.can_claim ? `<div class="pad" style="margin-top:14px"><button class="btn sec press" data-a="go" data-v="#claim/${o.id}">${ic('life-buoy', 20)}Buyurtmada muammo bormi?</button></div>` : '';
  const st = CLAIM_ST[c.status] || [c.status, ''];
  return `<div class="label">Shikoyat #${c.id}</div><div class="card col" style="margin:0 16px;padding:14px 16px;gap:8px">
    <div class="row sb"><b>${esc(c.category_name)}</b><span class="pill ${st[1]}">${st[0]}</span></div><span class="mut sm">${dt(c.created_at)} · ${esc(c.text)}</span>
    ${c.status !== 'open' ? `<div class="note ${c.compensation ? 'ok' : ''}">${ic('info', 18)}<span>${esc(c.resolution)}${c.compensation ? ` ${som(c.compensation)} sizga qaytariladi (1–3 ish kuni).` : ''}</span></div>`
      : `<textarea id="cnote" class="inp" rows="2" maxlength="1000" placeholder="Qo'shimcha ma'lumot"></textarea>
      <div class="row"><button class="btn sm sec" data-a="cphoto">${ic('scan-face', 16)} Rasm</button><span class="mut sm grow" id="cph"></span><button class="btn sm" data-a="claimNote" data-id="${c.id}">Yuborish</button></div>`}</div>`;
}
function viewClaim(id) {
  S.claimPhoto = null; S.claimCat = null;
  page(`${head('#order/' + id, 'Muammo haqida')}<div class="pad"><h1 class="h1" style="font-size:26px">Nima bo'ldi?</h1></div>
    <div class="card list" style="margin:14px 16px 0">${CLAIM_CAT.map(([k, n]) => `<button class="li press" data-a="ccat" data-v="${k}"><b class="grow" style="font-weight:600">${n}</b><span class="radio"></span></button>`).join('')}</div>
    <div class="card" style="margin:14px 16px 0;padding:14px"><span class="flabel" style="margin-top:0">Batafsil yozing</span><textarea id="ctext" class="inp" rows="3" maxlength="1000" placeholder="Masalan: 2 ta somsa o'rniga 1 ta keldi"></textarea>
      <span class="flabel">Zarar summasi (ixtiyoriy)</span><input id="camount" class="inp" type="number" inputmode="numeric" placeholder="0">
      <div class="row" style="margin-top:12px"><button class="btn sm sec" data-a="cphoto">${ic('scan-face', 16)} Rasm qo'shish</button><span class="mut sm" id="cph"></span></div>
      <p class="mut xs" style="margin:10px 0 0">Rasm (taom, paket, chek) shikoyatni tezroq hal qilishga yordam beradi. Platforma restoran va kuryer isbotlarini ham ko'rib chiqadi.</p></div>
    <div class="pad" style="margin-top:16px"><button class="btn press" data-a="claim" data-id="${id}">Shikoyat yuborish</button></div>`);
}
