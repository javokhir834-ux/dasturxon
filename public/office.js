// Dasturxon POS — 2-etap: Ombor va Hisobotlar (app.js dagi yordamchilardan foydalanadi)
'use strict';

const qtyFmt = (q, u) => `${Number(q).toLocaleString('ru-RU', { maximumFractionDigits: 3 }).replace(/ /g, ' ')} ${u || ''}`;
const MOVE_NAME = { income: ['Kirim', 'ok'], sale: ['Sotuv', ''], writeoff: ['Hisobdan chiqarish', 'danger'], inventory: ['Inventarizatsiya', 'warn'], produce_in: ['Tayyorlandi', 'info'], produce_out: ['Tayyorlashga', ''] };
const STOCK_TABS = [['stock', 'Qoldiqlar'], ['recipes', 'Texnologik kartalar'], ['invoices', 'Kirim'], ['writeoffs', 'Hisobdan chiqarish'], ['inventory', 'Inventarizatsiya'], ['suppliers', "Ta'minotchilar"], ['moves', 'Harakatlar']];
S.stockTab = 'stock'; S.stock = []; S.stockFilter = '';
const loadStock = async () => { S.stock = await api('GET', '/api/stock?all=1'); return S.stock; };
const activeIng = () => S.stock.filter((i) => i.active);
const ingOpts = (sel, filter = () => true) => activeIng().filter(filter).map((i) => `<option value="${i.id}" ${i.id === Number(sel) ? 'selected' : ''}>${esc(i.name)} (${i.unit})</option>`).join('');
const marginChip = (m, has) => !has ? '<span class="chip danger">texkarta yo\'q</span>' : `<span class="chip ${m >= 65 ? 'ok' : m >= 50 ? 'warn' : 'danger'}">${m}%</span>`;

// ---------- Umumiy: qatorli oyna (nakladnoy, chiqim) ----------
function linesModal({ title, withPrice, lines = [{}], extra = '', okText = 'Saqlash' }) {
  let n = 0;
  const row = (l = {}) => { const i = n++; return `<tr data-row="${i}"><td><select name="ing_${i}"><option value="">— tanlang —</option>${ingOpts(l.ingredient_id)}</select></td>
    <td style="width:110px"><input name="qty_${i}" type="number" step="0.001" inputmode="decimal" value="${l.qty ?? ''}" placeholder="0"></td>
    ${withPrice ? `<td style="width:130px"><input name="price_${i}" type="number" inputmode="numeric" value="${l.price ?? ''}" placeholder="1 birlik narxi"></td><td class="right num" style="width:110px" data-sum="${i}"></td>` : ''}
    <td style="width:44px"><button class="btn sm ghost" data-q="del">✕</button></td></tr>`; };
  const p = modal(`<h2>${title}</h2>${extra}<table class="list"><tr><th>Masalliq</th><th>Miqdor</th>${withPrice ? '<th>Narx (so\'m)</th><th class="right">Summa</th>' : ''}<th></th></tr>
    <tbody id="lm-rows">${lines.map(row).join('')}</tbody></table>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-q="add">+ Qator</button><div class="grow"></div>${withPrice ? '<b>Jami: <span id="lm-total" class="num">0</span></b>' : ''}</div>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">${okText}</button></div>`, { wide: true });
  const ov = document.querySelector('.overlay:last-child');
  const recalc = () => {
    if (!withPrice) return;
    let t = 0;
    ov.querySelectorAll('[data-row]').forEach((tr) => {
      const i = tr.dataset.row; const s = Math.round((Number(ov.querySelector(`[name="qty_${i}"]`).value) || 0) * (Number(ov.querySelector(`[name="price_${i}"]`).value) || 0));
      tr.querySelector(`[data-sum="${i}"]`).textContent = money(s); t += s;
    });
    ov.querySelector('#lm-total').textContent = money(t);
  };
  ov.addEventListener('input', recalc);
  ov.addEventListener('change', (e) => { // narx bo'sh bo'lsa, o'rtacha narxni taklif qilamiz
    const m = e.target.name?.match(/^ing_(\d+)$/); if (!m || !withPrice) return;
    const pr = ov.querySelector(`[name="price_${m[1]}"]`); const g = S.stock.find((x) => x.id === Number(e.target.value));
    if (pr && !pr.value && g) pr.value = g.cost; recalc();
  });
  ov.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (q === 'add') { ov.querySelector('#lm-rows').insertAdjacentHTML('beforeend', row()); }
    if (q === 'del') { e.target.closest('tr').remove(); recalc(); }
  });
  recalc();
  return p.then((r) => {
    if (!r) return null;
    const out = { ...r, lines: [] };
    Object.keys(r).filter((k) => k.startsWith('ing_')).forEach((k) => {
      const i = k.slice(4);
      if (!r[k] || !r['qty_' + i]) return;
      out.lines.push({ ingredient_id: Number(r[k]), qty: Number(r['qty_' + i]), ...(withPrice ? { price: Number(r['price_' + i]) || 0 } : {}) });
    });
    return out;
  });
}

// ---------- OMBOR ----------
VIEWS.stock = async function viewStock(main) {
  const tab = S.stockTab;
  const head = `<div class="sub-tabs">${STOCK_TABS.map(([k, n]) => `<button class="btn sm ${k === tab ? 'primary' : ''}" data-a="stab" data-v="${k}">${n}</button>`).join('')}</div>`;
  main.innerHTML = head + '<p class="muted">Yuklanmoqda...</p>';
  try { await loadStock(); await ST[tab](main, head); } catch (e) { toast(e.message, true); }
};
A.stab = (el) => { S.stockTab = el.dataset.v; renderView(); };

const ST = {};
ST.stock = (main, head) => {
  const q = S.stockFilter.toLowerCase();
  const list = S.stock.filter((i) => !q || i.name.toLowerCase().includes(q));
  const value = activeIng().reduce((s, i) => s + i.value, 0);
  const low = activeIng().filter((i) => i.low);
  main.innerHTML = head + `
    <div class="grid-stats"><div class="stat"><div class="muted small">Ombordagi mahsulot qiymati</div><div class="v">${som(value)}</div></div>
      <div class="stat"><div class="muted small">Masalliqlar</div><div class="v">${activeIng().length}</div></div>
      <div class="stat"><div class="muted small">Kam qolganlar</div><div class="v" style="color:${low.length ? 'var(--warn)' : ''}">${low.length}</div></div></div>
    <div class="row wrap" style="margin-bottom:12px"><input id="stock-q" placeholder="Qidirish..." value="${esc(S.stockFilter)}" style="max-width:260px">
      <div class="grow"></div><button class="btn primary" data-a="newInvoice">+ Kirim</button><button class="btn" data-a="newWriteoff">Hisobdan chiqarish</button>
      <button class="btn" data-a="produce">Yarim tayyor tayyorlash</button><button class="btn" data-a="ingEdit" data-id="">+ Masalliq</button></div>
    <div class="panel"><table class="list"><tr><th>Masalliq</th><th class="right">Qoldiq</th><th class="right">O'rtacha narx</th><th class="right">Summa</th><th class="right">Minimal</th><th></th></tr>
    ${list.map((i) => `<tr class="${i.active ? '' : 'off'}"><td><b>${esc(i.name)}</b> ${i.is_semi ? '<span class="chip info">yarim tayyor</span>' : ''} ${i.low && i.active ? '<span class="chip warn">kam qoldi</span>' : ''}</td>
      <td class="right num" style="color:${i.qty < 0 ? 'var(--danger)' : ''}">${qtyFmt(i.qty, i.unit)}</td><td class="right num">${money(i.cost)}</td><td class="right num">${money(i.value)}</td>
      <td class="right num muted">${qtyFmt(i.min_qty, i.unit)}</td>
      <td class="right"><button class="btn sm" data-a="ingMoves" data-id="${i.id}">Tarix</button><button class="btn sm" data-a="ingEdit" data-id="${i.id}">Tahrirlash</button></td></tr>`).join('')}</table></div>`;
  const inp = main.querySelector('#stock-q');
  inp.oninput = () => { S.stockFilter = inp.value; const pos = inp.selectionStart; ST.stock(main, head); const n = main.querySelector('#stock-q'); n.focus(); n.setSelectionRange(pos, pos); };
};
A.ingEdit = async (el) => {
  const id = Number(el.dataset.id) || null;
  const g = id ? S.stock.find((x) => x.id === id) : { unit: 'kg', cost: 0, min_qty: 0 };
  const r = await modal(`<h2>${id ? 'Masalliqni tahrirlash' : 'Yangi masalliq'}</h2>
    <label>Nomi</label><input name="name" value="${esc(g.name || '')}">
    <div class="paygrid"><div><label>O'lchov birligi</label><select name="unit">${['kg', 'l', 'dona'].map((u) => `<option ${g.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    <div><label>Narxi (1 birlik, so'm)</label><input name="cost" type="number" inputmode="numeric" value="${g.cost}"></div></div>
    <label>Minimal qoldiq (bundan kam bo'lsa ogohlantiradi)</label><input name="min_qty" type="number" step="0.001" value="${g.min_qty}">
    <label style="display:flex;gap:10px;align-items:center;margin-top:12px;color:var(--text)"><input type="checkbox" name="is_semi" style="width:22px;height:22px" ${g.is_semi ? 'checked' : ''}> Yarim tayyor mahsulot (xamir, qiyma, sous...)</label>
    ${id ? `<label style="display:flex;gap:10px;align-items:center;color:var(--text)"><input type="checkbox" name="active" style="width:22px;height:22px" ${g.active ? 'checked' : ''}> Faol</label>` : ''}
    <p class="muted small">Narx kirim qilinganda avtomatik o'rtacha narxga yangilanadi.</p>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
  if (!r) return;
  run(async () => { await api('POST', '/api/stock/ingredients', { ...(id ? { id, active: r.active } : {}), name: r.name, unit: r.unit, cost: Number(r.cost) || 0, min_qty: Number(r.min_qty) || 0, is_semi: r.is_semi }); renderView(); toast('Saqlandi'); });
};
A.ingMoves = (el) => { S.stockTab = 'moves'; S.movesIng = el.dataset.id; renderView(); };

A.newInvoice = async () => {
  const sups = await api('GET', '/api/suppliers').catch(() => []);
  const r = await linesModal({
    title: 'Kirim — nakladnoy', withPrice: true, okText: 'Kirim qilish',
    extra: `<div class="paygrid"><div><label>Ta'minotchi</label><select name="supplier_id"><option value="">— tanlanmagan —</option>${sups.filter((s) => s.active).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <div><label>Nakladnoy raqami</label><input name="number"></div>
      <div><label>Hozir to'langan summa</label><input name="paid_now" type="number" inputmode="numeric" placeholder="0 — qarzga"></div>
      <div><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="from_cash" style="width:20px;height:20px"> Kassadan naqd to'landi</label></div></div>`,
  });
  if (!r) return;
  if (!r.lines.length) return toast("Pozitsiya kiritilmadi", true);
  if (r.lines.some((l) => !l.price)) return toast('Har bir qator uchun narx kiriting', true);
  run(async () => { const res = await api('POST', '/api/stock/invoices', { supplier_id: Number(r.supplier_id) || null, number: r.number, items: r.lines, paid_now: Number(r.paid_now) || 0, from_cash: r.from_cash }); renderView(); toast(`Kirim qilindi: ${som(res.total)}`); });
};
A.newWriteoff = async () => {
  const r = await linesModal({ title: 'Hisobdan chiqarish', okText: 'Chiqarish', extra: `<label>Sababi</label><select name="reason"><option>Buzilgan / muddati o'tgan</option><option>Xodimlar ovqati</option><option>Mehmonlarga tekin (kompliment)</option><option>Sinov / yangi taom</option><option>Boshqa</option></select>` });
  if (!r) return;
  if (!r.lines.length) return toast("Pozitsiya kiritilmadi", true);
  run(async () => { const res = await api('POST', '/api/stock/writeoff', { reason: r.reason, items: r.lines }); renderView(); toast(`Hisobdan chiqarildi: ${som(res.sum)}`); });
};
A.produce = async () => {
  const semis = activeIng().filter((i) => i.is_semi);
  if (!semis.length) return toast("Yarim tayyor mahsulot yo'q. Masalliq qo'shishda belgilang", true);
  const r = await modal(`<h2>Yarim tayyor mahsulot tayyorlash</h2><label>Mahsulot</label><select name="semi_id">${semis.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.unit})</option>`).join('')}</select>
    <label>Qancha tayyorlandi</label><input name="qty" type="number" step="0.001" inputmode="decimal">
    <p class="muted small">Tarkibidagi masalliqlar texnologik karta bo'yicha avtomatik hisobdan chiqadi.</p>
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Tayyorlash</button></div>`);
  if (!r) return;
  run(async () => { await api('POST', '/api/stock/produce', { semi_id: Number(r.semi_id), qty: Number(r.qty) }); renderView(); toast('Tayyorlandi'); });
};

// Texnologik kartalar
ST.recipes = async (main, head) => {
  const costs = await api('GET', '/api/costs');
  const semis = activeIng().filter((i) => i.is_semi);
  S.recipeOwner ||= costs[0] ? { type: 'product', id: costs[0].id } : null;
  const noRec = costs.filter((c) => !c.lines).length;
  main.innerHTML = head + `<div class="row" style="align-items:flex-start;gap:14px;flex-wrap:wrap">
    <div class="panel" style="flex:1;min-width:320px;max-height:72vh;overflow:auto"><h3>Taomlar ${noRec ? `<span class="chip danger">${noRec} ta texkartasiz</span>` : ''}</h3>
      <table class="list"><tr><th>Taom</th><th class="right">Narx</th><th class="right">Tannarx</th><th class="right">Marja</th></tr>
      ${costs.map((c) => `<tr style="cursor:pointer;${S.recipeOwner?.type === 'product' && S.recipeOwner.id === c.id ? 'background:var(--card2)' : ''}" data-a="recOwner" data-t="product" data-id="${c.id}">
        <td>${esc(c.name)}</td><td class="right num">${money(c.price)}</td><td class="right num">${c.lines ? money(c.cost) : '—'}</td><td class="right">${marginChip(c.margin, c.lines)}</td></tr>`).join('')}</table>
      ${semis.length ? `<h3 style="margin-top:16px">Yarim tayyor mahsulotlar</h3><table class="list">${semis.map((s) => `<tr style="cursor:pointer;${S.recipeOwner?.type === 'semi' && S.recipeOwner.id === s.id ? 'background:var(--card2)' : ''}" data-a="recOwner" data-t="semi" data-id="${s.id}"><td>${esc(s.name)}</td><td class="right muted">1 ${s.unit} uchun</td></tr>`).join('')}</table>` : ''}
    </div>
    <div class="panel" style="flex:1.2;min-width:340px" id="rec-editor"><p class="muted">Chapdan taom tanlang</p></div></div>`;
  if (S.recipeOwner) await renderRecipeEditor(costs);
};
A.recOwner = (el) => { S.recipeOwner = { type: el.dataset.t, id: Number(el.dataset.id) }; renderView(); };
async function renderRecipeEditor(costs) {
  const box = $('#rec-editor'); const o = S.recipeOwner;
  const { lines } = await api('GET', `/api/recipes/${o.type}/${o.id}`);
  const owner = o.type === 'product' ? costs.find((c) => c.id === o.id) : S.stock.find((s) => s.id === o.id);
  if (!owner) { box.innerHTML = '<p class="muted">Topilmadi</p>'; return; }
  S.recipeLines = lines.map((l) => ({ ingredient_id: l.ingredient_id, qty: l.qty }));
  const draw = () => {
    const rows = S.recipeLines.map((l, i) => { const g = S.stock.find((x) => x.id === Number(l.ingredient_id)); return { ...l, i, g, sum: g ? Math.round((Number(l.qty) || 0) * g.cost) : 0 }; });
    const total = rows.reduce((s, r) => s + r.sum, 0);
    const margin = o.type === 'product' && owner.price ? Math.round((owner.price - total) / owner.price * 100) : null;
    box.innerHTML = `<div class="row"><h3 style="margin:0">${esc(owner.name)}</h3><div class="grow"></div>${o.type === 'product' ? `<span class="muted">Narx ${money(owner.price)}</span>` : `<span class="muted">1 ${owner.unit} uchun</span>`}</div>
      <p class="muted small">${o.type === 'product' ? '1 porsiya uchun masalliqlar (brutto). Sotilganda shu miqdor ombordan avtomatik chiqadi.' : 'Shu yarim tayyor mahsulotning 1 birligi uchun masalliqlar.'}</p>
      <table class="list"><tr><th>Masalliq</th><th style="width:120px">Miqdor</th><th class="right">Summa</th><th></th></tr>
      ${rows.map((r) => `<tr><td><select data-rl="ingredient_id" data-i="${r.i}"><option value="">— tanlang —</option>${ingOpts(r.ingredient_id, (x) => !(o.type === 'semi' && x.id === o.id))}</select></td>
        <td><input data-rl="qty" data-i="${r.i}" type="number" step="0.001" inputmode="decimal" value="${r.qty}"></td><td class="right num">${money(r.sum)}</td>
        <td><button class="btn sm ghost" data-a="recDel" data-i="${r.i}">✕</button></td></tr>`).join('')}</table>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-a="recAdd">+ Masalliq</button><div class="grow"></div>
        <b>Tannarx: <span class="num">${som(total)}</span></b>${margin != null ? ` &nbsp;${marginChip(margin, true)}` : ''}</div>
      <div class="foot"><button class="btn primary" data-a="recSave">Texkartani saqlash</button></div>`;
  };
  box.onchange = (e) => { const f = e.target.dataset.rl; if (!f) return; S.recipeLines[e.target.dataset.i][f] = e.target.value; draw(); };
  S.recipeDraw = draw; draw();
}
A.recAdd = () => { S.recipeLines.push({ ingredient_id: '', qty: '' }); S.recipeDraw(); };
A.recDel = (el) => { S.recipeLines.splice(Number(el.dataset.i), 1); S.recipeDraw(); };
A.recSave = () => {
  const lines = S.recipeLines.filter((l) => l.ingredient_id && Number(l.qty) > 0).map((l) => ({ ingredient_id: Number(l.ingredient_id), qty: Number(l.qty) }));
  run(async () => { await api('PUT', `/api/recipes/${S.recipeOwner.type}/${S.recipeOwner.id}`, { lines }); renderView(); toast('Texkarta saqlandi'); });
};

// Kirim (nakladnoylar)
ST.invoices = async (main, head) => {
  const list = await api('GET', '/api/stock/invoices');
  main.innerHTML = head + `<div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Nakladnoylar</h3><div class="grow"></div><button class="btn primary" data-a="newInvoice">+ Yangi kirim</button></div>
    <table class="list"><tr><th>Sana</th><th>Ta'minotchi</th><th>Raqam</th><th class="right">Pozitsiya</th><th class="right">Summa</th><th>Kim</th><th></th></tr>
    ${list.map((v) => `<tr><td>${dt(v.at)}</td><td>${esc(v.supplier_name || '—')}</td><td>${esc(v.number || '')}</td><td class="right">${v.lines}</td><td class="right num">${money(v.total)}</td><td class="muted">${esc(v.user_name || '')}</td>
      <td class="right"><button class="btn sm" data-a="invView" data-id="${v.id}">Ko'rish</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">—</td></tr>'}</table></div>`;
};
A.invView = (el) => run(async () => {
  const v = await api('GET', `/api/stock/invoices/${el.dataset.id}`);
  modal(`<h2>Nakladnoy ${esc(v.number || '#' + v.id)}</h2><p class="muted">${esc(v.supplier_name || '')} · ${dt(v.at)}</p>
    <table class="list"><tr><th>Masalliq</th><th class="right">Miqdor</th><th class="right">Narx</th><th class="right">Summa</th></tr>
    ${v.items.map((x) => `<tr><td>${esc(x.name)}</td><td class="right num">${qtyFmt(x.qty, x.unit)}</td><td class="right num">${money(x.price)}</td><td class="right num">${money(x.sum)}</td></tr>`).join('')}
    <tr><td colspan="3"><b>Jami</b></td><td class="right num"><b>${money(v.total)}</b></td></tr></table>
    <div class="foot"><button class="btn primary" data-m="close">Yopish</button></div>`, { wide: true });
});

// Hisobdan chiqarishlar tarixi
ST.writeoffs = async (main, head) => {
  const list = await api('GET', '/api/stock/moves?type=writeoff');
  const sum = list.reduce((s, m) => s + Math.round(-m.qty * m.cost), 0);
  main.innerHTML = head + `<div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Hisobdan chiqarilganlar <span class="chip danger">${som(sum)}</span></h3><div class="grow"></div><button class="btn primary" data-a="newWriteoff">Hisobdan chiqarish</button></div>
    <table class="list"><tr><th>Vaqt</th><th>Masalliq</th><th class="right">Miqdor</th><th class="right">Summa</th><th>Sabab</th><th>Kim</th></tr>
    ${list.map((m) => `<tr><td>${dt(m.at)}</td><td>${esc(m.name)}</td><td class="right num">${qtyFmt(-m.qty, m.unit)}</td><td class="right num">${money(Math.round(-m.qty * m.cost))}</td><td class="muted">${esc(m.note || '')}</td><td class="muted">${esc(m.user_name || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">—</td></tr>'}</table></div>`;
};

// Inventarizatsiya
ST.inventory = async (main, head) => {
  if (S.invForm) return drawInventoryForm(main, head);
  const list = await api('GET', '/api/stock/inventories');
  main.innerHTML = head + `<div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Inventarizatsiyalar</h3><div class="grow"></div><button class="btn primary" data-a="invStart">Yangi inventarizatsiya</button></div>
    <p class="muted small">Ombordagi mahsulotni sanab, haqiqiy qoldiqni kiritasiz. Tizim kamomad yoki ortiqchani hisoblab, qoldiqni to'g'rilaydi.</p>
    <table class="list"><tr><th>Sana</th><th>Izoh</th><th class="right">Pozitsiya</th><th class="right">Farq (so'm)</th><th>Kim</th><th></th></tr>
    ${list.map((v) => `<tr><td>${dt(v.at)}</td><td>${esc(v.note || '')}</td><td class="right">${v.lines}</td><td class="right num" style="color:${v.diff_sum < 0 ? 'var(--danger)' : 'var(--accent)'}">${money(v.diff_sum)}</td><td class="muted">${esc(v.user_name || '')}</td>
      <td class="right"><button class="btn sm" data-a="invnView" data-id="${v.id}">Ko'rish</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">—</td></tr>'}</table></div>`;
};
A.invStart = () => { S.invForm = {}; renderView(); };
A.invCancel = () => { S.invForm = null; renderView(); };
function drawInventoryForm(main, head) {
  const list = activeIng();
  const row = (i) => { const a = S.invForm[i.id]; const diff = a === undefined || a === '' ? null : Math.round((Number(a) - i.qty) * 1000) / 1000;
    return `<td class="right num" data-d="${i.id}" style="color:${diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--accent)' : ''}">${diff == null ? '' : qtyFmt(diff, i.unit)}</td><td class="right num" data-ds="${i.id}">${diff == null ? '' : money(Math.round(diff * i.cost))}</td>`; };
  const total = () => list.reduce((s, i) => { const a = S.invForm[i.id]; return a === undefined || a === '' ? s : s + Math.round((Number(a) - i.qty) * i.cost); }, 0);
  main.innerHTML = head + `<div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Yangi inventarizatsiya</h3><div class="grow"></div>
      <b>Farq: <span id="inv-total" class="num">${som(total())}</span></b><button class="btn" data-a="invCancel">Bekor</button><button class="btn primary" data-a="invSave">Yakunlash</button></div>
    <p class="muted small">Faqat sanalgan qatorlarni to'ldiring. Bo'sh qoldirilgan masalliqlar o'zgarmaydi.</p>
    <input id="inv-note" placeholder="Izoh (masalan: oylik inventarizatsiya)" style="margin-bottom:10px">
    <table class="list"><tr><th>Masalliq</th><th class="right">Tizimda</th><th style="width:140px">Haqiqiy (sanaldi)</th><th class="right">Farq</th><th class="right">Summa</th></tr>
    ${list.map((i) => `<tr><td>${esc(i.name)}</td><td class="right num">${qtyFmt(i.qty, i.unit)}</td><td><input data-inv="${i.id}" type="number" step="0.001" inputmode="decimal" value="${S.invForm[i.id] ?? ''}"></td>${row(i)}</tr>`).join('')}</table></div>`;
  main.querySelector('table.list').oninput = (e) => {
    const id = e.target.dataset.inv; if (!id) return;
    S.invForm[id] = e.target.value;
    const i = list.find((x) => x.id === Number(id));
    const tmp = document.createElement('tr'); tmp.innerHTML = row(i);
    main.querySelector(`[data-d="${id}"]`).replaceWith(tmp.children[0]); main.querySelector(`[data-ds="${id}"]`).replaceWith(tmp.children[0]);
    main.querySelector('#inv-total').textContent = som(total());
  };
}
A.invSave = async () => {
  const items = Object.entries(S.invForm).filter(([, v]) => v !== '').map(([id, v]) => ({ ingredient_id: Number(id), actual: Number(v) }));
  if (!items.length) return toast('Hech narsa kiritilmadi', true);
  if (!(await confirmBox('Inventarizatsiyani yakunlash', `${items.length} ta masalliq qoldig'i haqiqiy sanoqqa tenglashtiriladi. Bu amal jurnalga yoziladi.`, 'Yakunlash'))) return;
  run(async () => { const r = await api('POST', '/api/stock/inventory', { items, note: $('#inv-note')?.value || '' }); S.invForm = null; renderView(); toast(`Inventarizatsiya yakunlandi. Farq: ${som(r.diff_sum)}`); });
};
A.invnView = (el) => run(async () => {
  const v = await api('GET', `/api/stock/inventories/${el.dataset.id}`);
  modal(`<h2>Inventarizatsiya · ${dt(v.at)}</h2><p class="muted">${esc(v.note || '')}</p>
    <table class="list"><tr><th>Masalliq</th><th class="right">Tizimda</th><th class="right">Haqiqiy</th><th class="right">Farq</th><th class="right">Summa</th></tr>
    ${v.items.map((x) => `<tr><td>${esc(x.name)}</td><td class="right num">${qtyFmt(x.expected, x.unit)}</td><td class="right num">${qtyFmt(x.actual, x.unit)}</td>
      <td class="right num" style="color:${x.diff < 0 ? 'var(--danger)' : ''}">${qtyFmt(x.diff, x.unit)}</td><td class="right num">${money(Math.round(x.diff * x.cost))}</td></tr>`).join('')}
    <tr><td colspan="4"><b>Jami farq</b></td><td class="right num"><b>${money(v.diff_sum)}</b></td></tr></table>
    <div class="foot"><button class="btn primary" data-m="close">Yopish</button></div>`, { wide: true });
});

// Ta'minotchilar
ST.suppliers = async (main, head) => {
  const list = await api('GET', '/api/suppliers'); S.suppliers = list;
  const debt = list.reduce((s, x) => s + Math.max(0, x.debt), 0);
  main.innerHTML = head + `<div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Ta'minotchilar ${debt ? `<span class="chip warn">Umumiy qarz: ${som(debt)}</span>` : ''}</h3><div class="grow"></div><button class="btn primary" data-a="supEdit" data-id="">+ Ta'minotchi</button></div>
    <table class="list"><tr><th>Nomi</th><th>Telefon</th><th class="right">Olingan</th><th class="right">To'langan</th><th class="right">Qarz</th><th></th></tr>
    ${list.map((s) => `<tr class="${s.active ? '' : 'off'}"><td><b>${esc(s.name)}</b>${s.note ? `<div class="muted small">${esc(s.note)}</div>` : ''}</td><td>${esc(s.phone)}</td>
      <td class="right num">${money(s.bought)}</td><td class="right num">${money(s.paid)}</td><td class="right num" style="color:${s.debt > 0 ? 'var(--warn)' : ''}"><b>${money(s.debt)}</b></td>
      <td class="right">${s.debt > 0 ? `<button class="btn sm primary" data-a="supPay" data-id="${s.id}">To'lash</button>` : ''}<button class="btn sm" data-a="supEdit" data-id="${s.id}">Tahrirlash</button></td></tr>`).join('')}</table></div>`;
};
A.supEdit = async (el) => {
  const id = Number(el.dataset.id) || null; const s = id ? S.suppliers.find((x) => x.id === id) : {};
  const r = await modal(`<h2>${id ? "Ta'minotchini tahrirlash" : "Yangi ta'minotchi"}</h2><label>Nomi</label><input name="name" value="${esc(s.name || '')}">
    <label>Telefon</label><input name="phone" value="${esc(s.phone || '')}"><label>Izoh</label><input name="note" value="${esc(s.note || '')}">
    ${id ? `<label style="display:flex;gap:10px;align-items:center;margin-top:12px;color:var(--text)"><input type="checkbox" name="active" style="width:22px;height:22px" ${s.active ? 'checked' : ''}> Faol</label>` : ''}
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">Saqlash</button></div>`);
  if (r) run(async () => { await api('POST', '/api/suppliers', { ...(id ? { id, active: r.active } : {}), name: r.name, phone: r.phone, note: r.note }); renderView(); });
};
A.supPay = async (el) => {
  const s = S.suppliers.find((x) => x.id === Number(el.dataset.id));
  const r = await modal(`<h2>${esc(s.name)} — to'lov</h2><p class="muted">Qarz: ${som(s.debt)}</p>
    <label>Summa</label><input name="amount" type="number" inputmode="numeric" value="${s.debt}">
    <label>Usul</label><select name="method"><option value="naqd">Naqd</option><option value="karta">Karta</option><option value="otkazma">Bank o'tkazmasi</option></select>
    <label style="display:flex;gap:10px;align-items:center;margin-top:12px;color:var(--text)"><input type="checkbox" name="from_cash" style="width:22px;height:22px" ${S.boot.shift ? 'checked' : ''}> Naqd pul kassadan olindi (smenadan chiqim)</label>
    <label>Izoh</label><input name="note">
    <div class="foot"><button class="btn" data-m="close">Bekor</button><button class="btn primary" data-m="ok">To'lash</button></div>`);
  if (r) run(async () => { await api('POST', `/api/suppliers/${s.id}/pay`, { amount: Number(r.amount), method: r.method, from_cash: r.from_cash, note: r.note }); renderView(); toast("To'landi"); });
};

// Harakatlar jurnali
ST.moves = async (main, head) => {
  const iid = S.movesIng || '';
  const list = await api('GET', '/api/stock/moves' + (iid ? '?ingredient_id=' + iid : ''));
  main.innerHTML = head + `<div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Ombor harakatlari</h3><div class="grow"></div>
      <select id="mv-ing" style="max-width:260px"><option value="">Barcha masalliqlar</option>${S.stock.map((i) => `<option value="${i.id}" ${String(i.id) === String(iid) ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div>
    <table class="list"><tr><th>Vaqt</th><th>Masalliq</th><th>Turi</th><th class="right">Miqdor</th><th class="right">Narx</th><th>Izoh</th><th>Kim</th></tr>
    ${list.map((m) => { const [n, c] = MOVE_NAME[m.type] || [m.type, '']; return `<tr><td>${dt(m.at)}</td><td>${esc(m.name)}</td><td><span class="chip ${c}">${n}</span></td>
      <td class="right num" style="color:${m.qty < 0 ? 'var(--danger)' : 'var(--accent)'}">${m.qty > 0 ? '+' : ''}${qtyFmt(m.qty, m.unit)}</td><td class="right num">${money(m.cost)}</td><td class="muted small">${esc(m.note || '')}</td><td class="muted">${esc(m.user_name || '')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">—</td></tr>'}</table></div>`;
  main.querySelector('#mv-ing').onchange = (e) => { S.movesIng = e.target.value; renderView(); };
};

// ---------- HISOBOTLAR ----------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function preset(k) {
  const t = new Date(); const f = new Date();
  if (k === 'yesterday') { t.setDate(t.getDate() - 1); f.setDate(f.getDate() - 1); }
  if (k === '7') f.setDate(f.getDate() - 6);
  if (k === '30') f.setDate(f.getDate() - 29);
  if (k === 'month') f.setDate(1);
  return { from: ymd(f), to: ymd(t), k };
}
S.range = preset('7');

// Bitta qatorli ustunli grafik: bitta rang, ingichka ustunlar, ustiga borilganda tooltip
function barChart(items, { label, short, value, fmt = money, height = 160 }) {
  const realMax = Math.max(0, ...items.map(value));
  const max = Math.max(1, realMax);
  const ticks = realMax ? [max, max / 2, 0] : [null, null, 0];
  return `<div class="chart" style="--h:${height}px">
    <div class="chart-y">${ticks.map((t) => `<span>${t == null ? '' : fmt(Math.round(t))}</span>`).join('')}</div>
    <div class="chart-plot"><div class="chart-grid"><i></i><i></i><i></i></div>
      ${items.map((it) => { const v = value(it); return `<div class="chart-col" tabindex="0" data-tip="${esc(label(it))}: ${esc(fmt(v))}"><div class="chart-bar" style="height:${v ? Math.max(2, v / max * 100) : 0}%"></div></div>`; }).join('')}
    </div></div>
    <div class="chart-x">${items.map((it, i) => `<span>${items.length > 16 && i % Math.ceil(items.length / 12) ? '' : esc(short(it))}</span>`).join('')}</div>`;
}

VIEWS.reports = async function viewReports(main) {
  const r0 = S.range;
  const presets = [['today', 'Bugun'], ['yesterday', 'Kecha'], ['7', '7 kun'], ['30', '30 kun'], ['month', 'Shu oy']];
  const head = `<div class="row wrap" style="margin-bottom:14px">${presets.map(([k, n]) => `<button class="btn sm ${r0.k === k ? 'primary' : ''}" data-a="rpreset" data-v="${k}">${n}</button>`).join('')}
    <div class="grow"></div><input type="date" id="r-from" value="${r0.from}" style="max-width:160px"><span class="muted">—</span><input type="date" id="r-to" value="${r0.to}" style="max-width:160px">
    <button class="btn sm" data-a="rcustom">Ko'rsatish</button></div>`;
  main.innerHTML = head + '<p class="muted">Yuklanmoqda...</p>';
  let r;
  try { r = await api('GET', `/api/reports/sales?from=${r0.from}&to=${r0.to}`); } catch (e) { main.innerHTML = head; return toast(e.message, true); }
  if (S.view !== 'reports') return;
  const st = (n, v, sub = '', color = '') => `<div class="stat"><div class="muted small">${n}</div><div class="v" ${color ? `style="color:${color}"` : ''}>${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
  const dayLbl = (d) => { const [, m, dd] = d.day.split('-'); return `${dd}.${m}`; };
  const activeHours = r.hours.filter((h) => h.orders || (h.h >= 8 && h.h <= 23));
  main.innerHTML = head + `
    ${r.noRecipe.length ? `<div class="panel row"><span class="chip warn">Diqqat</span><span class="muted small">Texnologik kartasi yo'q taomlar sotilgan, ularning tannarxi 0 deb hisoblandi: ${esc(r.noRecipe.join(', '))}</span></div>` : ''}
    <div class="grid-stats">
      ${st('Tushum', som(r.revenue))}${st('Buyurtmalar', r.orders, `${r.guests} mehmon`)}${st("O'rtacha chek", som(r.avg))}
      ${st('Tannarx (masalliqlar)', som(r.cost))}${st('Yalpi foyda', som(r.profit), `marja ${r.margin}% · xizmat haqisiz`, r.profit < 0 ? 'var(--danger)' : '')}
      ${st('Chegirmalar', som(r.discounts))}${st('Xizmat haqi', som(r.service))}
      ${st('Hisobdan chiqarilgan', som(r.writeoffs), 'buzilgan, bekor qilingan va h.k.')}${st('Inventarizatsiya farqi', som(r.inventoryDiff), '', r.inventoryDiff < 0 ? 'var(--danger)' : '')}
    </div>
    <div class="panel"><h3>To'lov turlari</h3><div class="row wrap">${REPORT_METHODS.map(([k, n]) => `<span class="chip">${n}: ${som(r.byMethod[k] || 0)}</span>`).join('')}</div></div>
    <div class="row wrap" style="align-items:stretch">
      <div class="panel grow" style="min-width:340px"><h3>Kunlar bo'yicha tushum</h3>${barChart(r.days, { label: (d) => dayLbl(d) + ' · ' + d.orders + ' buyurtma', short: dayLbl, value: (d) => d.revenue })}</div>
      <div class="panel grow" style="min-width:340px"><h3>Soatlar bo'yicha tushum</h3>${barChart(activeHours, { label: (h) => `${String(h.h).padStart(2, '0')}:00 · ${h.orders} buyurtma`, short: (h) => String(h.h).padStart(2, '0'), value: (h) => h.revenue })}</div>
    </div>
    <div class="row wrap" style="align-items:flex-start">
      <div class="panel grow" style="min-width:320px"><h3>Ofitsiantlar</h3><table class="list"><tr><th>Ofitsiant</th><th class="right">Buyurtma</th><th class="right">Mehmon</th><th class="right">Tushum</th><th class="right">O'rt. chek</th></tr>
        ${r.waiters.map((w) => `<tr><td>${esc(w.name)}</td><td class="right">${w.orders}</td><td class="right">${w.guests}</td><td class="right num">${money(w.revenue)}</td><td class="right num">${money(Math.round(w.revenue / w.orders))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>'}</table></div>
      <div class="panel grow" style="min-width:320px"><h3>Kategoriyalar</h3><table class="list"><tr><th>Kategoriya</th><th class="right">Soni</th><th class="right">Sotuv</th><th class="right">Tannarx</th><th class="right">Marja</th></tr>
        ${r.categories.map((c) => `<tr><td>${esc(c.name)}</td><td class="right">${c.qty}</td><td class="right num">${money(c.revenue)}</td><td class="right num">${money(c.cost)}</td><td class="right">${marginChip(c.revenue ? Math.round((c.revenue - c.cost) / c.revenue * 100) : 0, c.cost > 0)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>'}</table></div>
    </div>
    <div class="panel"><h3>Taomlar — ABC tahlil</h3><p class="muted small">A — sotuvning 80% ini beradigan asosiy taomlar, B — keyingi 15%, C — qolgan 5% (menyudan olib tashlash yoki o'zgartirishga nomzodlar). Summalar chegirmasiz.</p>
      <table class="list"><tr><th>Taom</th><th>Guruh</th><th class="right">Soni</th><th class="right">Sotuv</th><th class="right">Ulushi</th><th class="right">Tannarx</th><th class="right">Foyda</th><th class="right">Marja</th></tr>
      ${r.products.map((p) => `<tr><td>${esc(p.name)}</td><td><span class="chip ${p.abc === 'A' ? 'ok' : p.abc === 'B' ? 'info' : ''}">${p.abc}</span></td><td class="right">${p.qty}</td><td class="right num">${money(p.revenue)}</td><td class="right">${p.share}%</td>
        <td class="right num">${money(p.cost)}</td><td class="right num">${money(p.profit)}</td><td class="right">${marginChip(p.revenue ? Math.round(p.profit / p.revenue * 100) : 0, p.cost > 0)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Bu davrda sotuv yo\'q</td></tr>'}</table></div>`;
};
A.rpreset = (el) => { S.range = preset(el.dataset.v); renderView(); };
A.rcustom = () => {
  const from = $('#r-from').value, to = $('#r-to').value;
  if (!from || !to || from > to) return toast("Sanalar noto'g'ri", true);
  S.range = { from, to, k: '' }; renderView();
};
