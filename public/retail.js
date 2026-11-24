// Dasturxon POS — 9-etap: "Tez sotuv" (stolsiz kassa): do'kon, dorixona, olib ketish. Shtrix-kod skaneri (klaviatura kabi) qo'llab-quvvatlanadi.
'use strict';

S.cart = S.cart || { lines: [], method: 'naqd', given: '', rx: false, cat: null, q: '' };
const kgTxt = (g) => `${+(g / 1000).toFixed(3)} kg`;
const lineSum = (l) => (l.weight_g ? Math.round((l.p.price * l.weight_g) / 1000) : l.p.price * l.qty);
const cartTotal = () => S.cart.lines.reduce((t, l) => t + lineSum(l), 0);

function viewCounter(main) {
  const c = S.cart, prods = (S.boot.products || []).filter((p) => (!c.cat || p.category_id === c.cat));
  const q = c.q.trim().toLowerCase();
  const list = q ? (S.boot.products || []).filter((p) => p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))) : prods;
  const total = cartTotal(), given = Number(c.given) || 0, hasRx = c.lines.some((l) => l.p.rx);
  main.innerHTML = `${!S.boot.shift ? '<div class="banner warn" style="margin:-16px -16px 14px">Smena yopiq — sotish uchun Kassa bo\'limida smenani oching.</div>' : ''}
  <div class="counter">
    <section class="cleft">
      <input id="cq" class="csearch" placeholder="🔎 Nomi yoki shtrix-kod (skaner)…" value="${esc(c.q)}" autocomplete="off">
      <div class="chips cchips"><button class="${!c.cat ? 'on' : ''}" data-a="cCat" data-v="">Hammasi</button>${S.boot.categories.map((k) => `<button class="${c.cat === k.id ? 'on' : ''}" data-a="cCat" data-v="${k.id}">${esc(k.name)}</button>`).join('')}</div>
      <div class="cgrid">${list.slice(0, 120).map((p) => `<button class="ctile ${p.in_stop ? 'stop' : ''}" data-a="cAdd" data-id="${p.id}" ${p.in_stop ? 'disabled' : ''}>
        <b>${esc(p.name)}</b><span>${money(p.price)}${p.sold_by === 'kg' ? '/kg' : ''}</span>${p.rx ? '<i class="chip danger">Rx</i>' : ''}${p.sold_by === 'kg' ? '<i class="chip">⚖</i>' : ''}</button>`).join('') || '<div class="muted">Topilmadi</div>'}</div>
    </section>
    <section class="cright panel">
      <h3 style="margin-top:0">Chek</h3>
      <div class="clines">${c.lines.map((l, i) => `<div class="line"><div class="grow"><div>${esc(l.p.name)}${l.p.rx ? ' <span class="chip danger">Rx</span>' : ''}</div>
          <div class="muted small">${l.weight_g ? `${kgTxt(l.weight_g)} × ${money(l.p.price)}/kg` : `${money(l.p.price)}`}</div></div>
          ${l.weight_g ? `<button class="btn sm" data-a="cWeight" data-i="${i}">⚖</button>` : `<div class="step"><button data-a="cQty" data-i="${i}" data-d="-1">−</button><span>${l.qty}</span><button data-a="cQty" data-i="${i}" data-d="1">+</button></div>`}
          <b class="num" style="min-width:80px;text-align:right">${money(lineSum(l))}</b><button class="btn sm ghost" data-a="cDel" data-i="${i}">✕</button></div>`).join('') || '<div class="muted small">Mahsulot tanlang yoki skanerlang</div>'}</div>
      <div class="sum"><div class="r b"><span>Jami</span><span class="num">${som(total)}</span></div></div>
      <div class="row wrap" style="gap:6px;margin:10px 0">${[['naqd', 'Naqd'], ['karta', 'Karta'], ['click', 'Click'], ['payme', 'Payme']].map(([k, n]) => `<button class="btn sm ${c.method === k ? 'primary' : ''}" data-a="cMethod" data-v="${k}">${n}</button>`).join('')}</div>
      ${c.method === 'naqd' ? `<label>Berilgan summa</label><input id="cgiven" type="number" inputmode="numeric" value="${esc(c.given)}" placeholder="${total}">
        ${given > total ? `<div class="note ok" style="margin-top:8px">Qaytim: <b>${som(given - total)}</b></div>` : ''}` : ''}
      ${hasRx ? `<label class="chk"><input type="checkbox" id="crx" ${c.rx ? 'checked' : ''}> Retsept tekshirildi (Rx dori)</label>` : ''}
      <button class="btn primary block" style="min-height:54px;margin-top:12px;font-size:17px" data-a="cPay" ${c.lines.length && S.boot.shift ? '' : 'disabled'}>To'lash · ${som(total)}</button>
      ${c.lines.length ? '<button class="btn ghost block" style="margin-top:6px" data-a="cClear">Tozalash</button>' : ''}
    </section>
  </div>`;
  const inp = $('#cq');
  inp.oninput = () => { c.q = inp.value; const pos = inp.selectionStart; renderView(); const n = $('#cq'); n.focus(); n.setSelectionRange(pos, pos); };
  inp.onkeydown = (e) => { // skaner: kod + Enter
    if (e.key !== 'Enter') return;
    const code = inp.value.trim(); if (!code) return;
    const p = (S.boot.products || []).find((x) => x.barcode && x.barcode === code) || (list.length === 1 ? list[0] : null);
    c.q = '';
    if (p) addProduct(p); else { toast(`"${code}" topilmadi`, true); renderView(); }
  };
  const g = $('#cgiven'); if (g) g.onchange = () => { c.given = g.value; renderView(); };
  const rx = $('#crx'); if (rx) rx.onchange = () => { c.rx = rx.checked; };
  if (!document.querySelector('.overlay')) setTimeout(() => $('#cq')?.focus(), 0);
}
VIEWS.counter = viewCounter;

async function askWeight(p, cur) {
  const v = await modal(`<h2>⚖ ${esc(p.name)}</h2><p class="muted">Narx: ${money(p.price)} so'm / kg. Tarozidagi og'irlikni kiriting.</p>
    <label>Og'irligi (kg)</label><input name="kg" type="number" step="0.005" min="0.005" inputmode="decimal" value="${cur ? +(cur / 1000).toFixed(3) : ''}" placeholder="masalan 1.25">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Qo'shish</button></div>`);
  const kg = v && Number(String(v.kg).replace(',', '.'));
  return kg > 0 ? Math.round(kg * 1000) : null;
}
async function addProduct(p) {
  const c = S.cart;
  if (p.sold_by === 'kg') { const g = await askWeight(p); if (g) c.lines.push({ p, qty: 1, weight_g: g }); }
  else { const l = c.lines.find((x) => x.p.id === p.id && !x.weight_g); if (l) l.qty++; else c.lines.push({ p, qty: 1 }); }
  renderView();
}
A.cCat = (el) => { S.cart.cat = Number(el.dataset.v) || null; renderView(); };
A.cAdd = (el) => { const p = S.boot.products.find((x) => x.id === Number(el.dataset.id)); if (p) addProduct(p); };
A.cQty = (el) => { const l = S.cart.lines[el.dataset.i]; l.qty += Number(el.dataset.d); if (l.qty < 1) S.cart.lines.splice(el.dataset.i, 1); renderView(); };
A.cDel = (el) => { S.cart.lines.splice(el.dataset.i, 1); renderView(); };
A.cWeight = async (el) => { const l = S.cart.lines[el.dataset.i]; const g = await askWeight(l.p, l.weight_g); if (g) l.weight_g = g; renderView(); };
A.cMethod = (el) => { S.cart.method = el.dataset.v; renderView(); };
A.cClear = () => { S.cart = { ...S.cart, lines: [], given: '', rx: false }; renderView(); };
A.cPay = (el) => run(async () => {
  const c = S.cart, total = cartTotal();
  const amount = c.method === 'naqd' ? Math.max(total, Number(c.given) || total) : total;
  el.disabled = true;
  try {
    const r = await api('POST', '/api/counter/sale', { items: c.lines.map((l) => ({ product_id: l.p.id, ...(l.weight_g ? { weight_g: l.weight_g } : { qty: l.qty }) })),
      payments: [{ method: c.method, amount }], rx_checked: !!c.rx });
    S.cart = { ...c, lines: [], given: '', rx: false };
    toast(r.change ? `Sotildi · qaytim ${som(r.change)}` : `Sotildi · #${r.order.number}`);
    renderView();
  } finally { el.disabled = false; }
});
