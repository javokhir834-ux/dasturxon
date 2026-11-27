// Hamkorlikka qabul (biznes): /#register — 4 bosqichli so'rovnoma (biznes, so'rovnoma, hisob, maxfiylik va shartlar testi) → ariza.
// Platforma paneli → 📝 Arizalar: biznes arizalarini ko'rish, tasdiqlash yoki rad etish. Server: src/modules/onboarding.ts.
'use strict';

const ONBOARD = (() => {
  const TYPES = [['restoran', 'Restoran'], ['milliy', 'Milliy taomlar'], ['fastfood', 'Fast food'], ['pizza', 'Pitsa'], ['sushi', 'Sushi'], ['kafe', 'Kafe'],
    ['choyxona', 'Choyxona'], ['shirinlik', 'Shirinliklar'], ['nonvoyxona', 'Non va pishiriq'], ['dokon', "Do'kon"], ['dorixona', 'Dorixona']];
  const STEPS = ['Biznes', "So'rovnoma", 'Hisob', 'Maxfiylik'];
  const W = { step: 0, v: { legal_form: 'yatt', own_couriers: false, sample: true }, quiz: null, answers: [] };
  const val = (id) => document.getElementById(id)?.value ?? '';
  const field = (id, label, attrs = '') => `<label>${label}</label><input id="${id}" value="${esc(W.v[id] ?? '')}" ${attrs}>`;
  const keep = () => document.querySelectorAll('#ob [id]').forEach((el) => { if (el.type === 'checkbox') W.v[el.id] = el.checked; else if (el.tagName !== 'DIV') W.v[el.id] = el.value; });

  function business(UI) {
    const { shell, bind, H, papi } = UI;
    const back = '<a class="btn sm" href="#" data-p="toPos">← POS ga</a>';
    const bar = () => `<div class="row" style="gap:6px;margin-bottom:16px">${STEPS.map((s, i) => `<div class="grow"><div style="height:5px;border-radius:3px;background:${i <= W.step ? 'var(--accent)' : 'var(--line)'}"></div>
      <div class="small" style="margin-top:6px;color:${i <= W.step ? 'var(--text)' : 'var(--muted)'};font-weight:600">${s}</div></div>`).join('')}</div>`;
    const draw = () => {
      let body = '';
      if (W.step === 0) body = `<h2 style="margin-top:0">Biznesingiz haqida</h2><p class="muted small">Ariza platforma tomonidan tekshiriladi (odatda 1 ish kuni). Tasdiqlangach 14 kunlik bepul sinov boshlanadi.</p>
        ${field('business_name', 'Biznes nomi (mijozlarga ko\'rinadi)', 'placeholder="masalan: Bahor kafe"')}
        <label>Turi</label><select id="place_type">${TYPES.map(([k, n]) => `<option value="${k}" ${W.v.place_type === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <label>Yuridik shakl</label><div class="pick" style="grid-template-columns:1fr 1fr">${[['yatt', 'YaTT'], ['mchj', 'MChJ']].map(([k, n]) => `<button class="${W.v.legal_form === k ? 'on' : ''}" data-p="obForm" data-v="${k}">${n}</button>`).join('')}</div>
        ${field('legal_name', 'Yuridik nomi (guvohnomadagidek)')}${field('inn', 'STIR (9 xonali) yoki JShShIR', 'inputmode="numeric" maxlength="14"')}
        ${field('address', 'Manzil', 'placeholder="Shahar, ko\'cha, uy"')}${field('owner_name', 'Ismingiz (ega)')}${field('phone', 'Telefon raqam', 'inputmode="tel" placeholder="90 123 45 67"')}`;
      if (W.step === 1) body = `<h2 style="margin-top:0">So'rovnoma</h2><p class="muted small">Javoblar platformaga biznesingizni to'g'ri sozlashga yordam beradi.</p>
        ${field('work_hours', 'Ish vaqti', 'placeholder="09:00–23:00"')}${field('staff_count', 'Xodimlar soni', 'type="number" min="1"')}
        ${field('daily_orders', "Kuniga taxminan nechta buyurtma?", 'type="number" min="0"')}
        <label class="chk"><input type="checkbox" id="own_couriers" ${W.v.own_couriers ? 'checked' : ''}> O'z kuryerlarimiz bor (platforma kuryerlari ham ishlatiladi)</label>
        <div id="licbox" ${val('place_type') === 'dorixona' || W.v.place_type === 'dorixona' ? '' : 'hidden'}>${field('license_no', 'Dorixona litsenziyasi raqami')}</div>
        <label>Qo'shimcha izoh (ixtiyoriy)</label><textarea id="note" rows="2" maxlength="500">${esc(W.v.note || '')}</textarea>`;
      if (W.step === 2) body = `<h2 style="margin-top:0">Hisob</h2>
        ${field('password', 'Ega kabineti paroli (kamida 6 belgi)', 'type="password"')}${field('admin_pin', 'Admin PIN (planshetga kirish uchun, 4 raqam)', 'inputmode="numeric" maxlength="4"')}
        <label class="chk"><input type="checkbox" id="sample" ${W.v.sample ? 'checked' : ''}> Namuna menyu bilan boshlash</label>`;
      if (W.step === 3) body = !W.quiz ? '<p class="muted">Yuklanmoqda…</p>' : `<h2 style="margin-top:0">Maxfiylik va shartlar</h2>
        <p class="muted small">Hamkorlikdan oldin asosiy qoidalarni o'qing. To'liq matn: <a href="/legal/privacy" target="_blank">maxfiylik siyosati</a> va
          <a href="/legal/terms" target="_blank">foydalanish shartlari (oferta)</a>. Versiya: ${esc(W.quiz.version)}.</p>
        <ol class="small" style="padding-left:20px;line-height:1.55">${W.quiz.points.map((p) => `<li style="margin:6px 0">${esc(p)}</li>`).join('')}</ol>
        <h3 style="margin:18px 0 6px">O'qiganingizni tekshiramiz</h3>
        ${W.quiz.questions.map((q, i) => `<div style="margin:12px 0"><b class="small">${i + 1}. ${esc(q.q)}</b><div class="pick" style="grid-template-columns:1fr;margin-top:6px">
          ${q.a.map((t, j) => `<button class="${W.answers[i] === j ? 'on' : ''}" data-p="obAns" data-q="${i}" data-v="${j}">${esc(t)}</button>`).join('')}</div></div>`).join('')}
        <label class="chk"><input type="checkbox" id="agree" ${W.v.agree ? 'checked' : ''}> Maxfiylik siyosati va foydalanish shartlarini o'qidim va roziman</label>`;
      const last = W.step === STEPS.length - 1;
      shell("Hamkor bo'lish", back, `<div class="page-narrow panel" id="ob" style="max-width:560px">${bar()}${body}
        <div class="row" style="margin-top:18px;gap:10px">${W.step ? '<button class="btn" data-p="obBack">Orqaga</button>' : ''}<button class="btn primary grow" data-p="${last ? 'obSubmit' : 'obNext'}">${last ? 'Arizani yuborish' : 'Davom etish'}</button></div>
        <p class="muted small" style="text-align:center">Akkauntingiz bormi? <a href="#owner">Ega kabinetiga kiring</a></p></div>`);
      bind();
      const pt = document.getElementById('place_type'); if (pt) pt.onchange = () => { W.v.place_type = pt.value; };
      if (W.step === 3 && !W.quiz) papi('', 'GET', '/api/onboarding/business').then((q) => { W.quiz = q; draw(); }).catch((e) => toast(e.message, true));
    };
    // Bosqich tekshiruvi (asosiy xatolarni server ham qaytaradi)
    const need = { 0: ['business_name', 'legal_name', 'inn', 'address', 'owner_name', 'phone'], 1: ['work_hours', 'staff_count'], 2: ['password', 'admin_pin'] };
    H.obForm = (el) => { keep(); W.v.legal_form = el.dataset.v; draw(); };
    H.obAns = (el) => { keep(); W.answers[Number(el.dataset.q)] = Number(el.dataset.v); draw(); };
    H.obBack = () => { keep(); W.step--; draw(); };
    H.obNext = () => {
      keep();
      const miss = (need[W.step] || []).find((k) => !String(W.v[k] || '').trim());
      if (miss) { toast("Barcha maydonlarni to'ldiring", true); document.getElementById(miss)?.focus(); return; }
      if (W.step === 0 && !/^(\d{9}|\d{14})$/.test(String(W.v.inn).trim())) return toast("STIR 9 xonali (yoki JShShIR 14 xonali) bo'lsin", true);
      if (W.step === 1 && W.v.place_type === 'dorixona' && String(W.v.license_no || '').trim().length < 3) return toast('Dorixona litsenziyasi raqamini yozing', true);
      W.step++; draw();
    };
    H.obSubmit = async () => {
      keep();
      if (!W.quiz || W.answers.filter((x) => x != null).length < W.quiz.questions.length) return toast('Hamma savolga javob bering', true);
      if (!W.v.agree) return toast('Shartlarga rozilikni belgilang', true);
      const v = W.v;
      try {
        const r = await papi('', 'POST', '/api/register', { business_name: v.business_name, owner_name: v.owner_name, phone: v.phone, password: v.password, admin_pin: v.admin_pin, sample: !!v.sample,
          application: { place_type: v.place_type || 'restoran', legal_form: v.legal_form, legal_name: v.legal_name, inn: String(v.inn).trim(), address: v.address, work_hours: v.work_hours,
            own_couriers: !!v.own_couriers, staff_count: Number(v.staff_count) || 0, daily_orders: Number(v.daily_orders) || 0, license_no: v.license_no || '', note: v.note || '' },
          consent: { answers: W.answers, agree: true } });
        store.set('bizcode', r.code); store.set('bizname', v.business_name.trim());
        const pend = r.approval === 'pending';
        document.getElementById('pg').innerHTML = `<div class="page-narrow panel" style="text-align:center"><h2 style="margin-top:0">${pend ? 'Ariza qabul qilindi' : 'Tabriklaymiz! 🎉'}</h2>
          <p>Biznesingiz kodi:</p><div class="bigcode">${esc(r.code)}</div>
          ${pend ? `<div class="note warn" style="text-align:left">Arizangiz platforma tomonidan tekshirilmoqda (odatda 1 ish kuni). Tasdiqlangach PIN bilan kirasiz va ${r.trial_days} kunlik sinov boshlanadi.
            Holatni <a href="#owner">ega kabinetida</a> ko'rasiz.</div>` : `<p class="muted small">Sinov muddati: ${r.trial_days} kun.</p>`}
          <p class="muted small">Shu kodni yozib qo'ying: planshet va telefonlar shu kod bilan ulanadi.</p>
          ${pend ? '<a class="btn primary block" href="#owner">Ega kabineti</a>' : '<button class="btn primary block" data-p="toPos">POS ni ochish (PIN bilan kirish)</button>'}</div>`;
        Object.assign(W, { step: 0, v: { legal_form: 'yatt', own_couriers: false, sample: true }, answers: [] });
      } catch (e) { toast(e.message, true); }
    };
    draw();
  }

  // ---------- Platforma: arizalar ----------
  function platform(UI) {
    const { papi, shell, bind, nav, H } = UI;
    const ST = { pending: ['Tekshirilmoqda', 'warn'], approved: ['Tasdiqlangan', 'ok'], rejected: ['Rad etilgan', 'danger'] };
    const TN = Object.fromEntries(TYPES);
    H.platApps = async () => {
      let list; try { list = await papi('ptoken', 'GET', '/api/platform/applications'); } catch (e) { return toast(e.message, true); }
      const pend = list.filter((x) => x.approval === 'pending').length;
      shell('Arizalar', nav('platApps'), `<div class="panel"><h3>Biznes arizalari ${pend ? `<span class="chip warn">${pend} kutmoqda</span>` : ''}</h3>
        <p class="muted small">Tasdiqlanmaguncha biznes panelga kira olmaydi va mijoz ilovasida ko'rinmaydi. Tasdiqlangan kundan sinov muddati boshlanadi.</p></div>
        ${list.map((b) => { const a = b.application || {}, c = b.consent; return `<div class="panel"><div class="row wrap"><h3 style="margin:0">${esc(b.name)}</h3>
          <span class="chip ${ST[b.approval]?.[1] || ''}">${ST[b.approval]?.[0] || b.approval}</span><div class="grow"></div><span class="muted small">kod ${esc(b.code)} · ${dt(b.applied_at)}</span></div>
          <div class="paygrid" style="margin-top:10px;font-size:14px">
            <div><span class="muted small">Turi</span><div>${esc(TN[a.place_type] || a.place_type || '—')}</div></div><div><span class="muted small">Yuridik</span><div>${esc((a.legal_form || '').toUpperCase())} «${esc(a.legal_name || '')}» · STIR ${esc(a.inn || '')}</div></div>
            <div><span class="muted small">Manzil</span><div>${esc(a.address || '')}</div></div><div><span class="muted small">Ega</span><div>${esc(b.owner_name || '')} · ${esc(fmtPhone(b.owner_phone || ''))}</div></div>
            <div><span class="muted small">Ish vaqti · xodimlar · kunlik buyurtma</span><div>${esc(a.work_hours || '')} · ${a.staff_count ?? '—'} · ${a.daily_orders ?? '—'}</div></div>
            <div><span class="muted small">O'z kuryerlari · litsenziya</span><div>${a.own_couriers ? 'Bor' : "Yo'q"}${a.license_no ? ' · ' + esc(a.license_no) : ''}</div></div></div>
          ${a.note ? `<div class="note-line small">${esc(a.note)}</div>` : ''}
          <div class="small" style="margin-top:8px">${c ? `<span class="chip ok">✓ Maxfiylik testi ${c.score}/${c.total}</span> <span class="muted">versiya ${esc(c.version)} · ${dt(c.at)} · IP ${esc(c.ip || '')}</span>` : '<span class="chip warn">Rozilik yo\'q</span>'}</div>
          ${b.approval_note ? `<div class="note-line small">Sabab: ${esc(b.approval_note)}</div>` : ''}
          ${b.approval !== 'approved' ? `<div class="row" style="margin-top:12px;gap:8px"><button class="btn primary sm" data-p="appSet" data-id="${b.id}" data-v="approve">Tasdiqlash</button>
            ${b.approval === 'pending' ? `<button class="btn danger sm" data-p="appSet" data-id="${b.id}" data-v="reject">Rad etish</button>` : ''}</div>` : ''}</div>`; }).join('') || '<div class="panel muted">Ariza yo\'q</div>'}`);
      bind();
    };
    H.appSet = async (el) => {
      let note = '';
      if (el.dataset.v === 'reject') { note = prompt('Rad etish sababi (egaga ko\'rinadi):') || ''; if (!note.trim()) return; }
      try { await papi('ptoken', 'POST', `/api/platform/applications/${el.dataset.id}`, { action: el.dataset.v, note }); toast(el.dataset.v === 'approve' ? 'Tasdiqlandi' : 'Rad etildi'); H.platApps(); } catch (e) { toast(e.message, true); }
    };
  }
  return { business, platform };
})();

ONBOARD.platform(PLATFORM_UI);
