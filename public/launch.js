// FastHub — 10-etap: platforma paneli → 🚀 Ishga chiqarish: tayyorlik ro'yxati, tizim holati (zaxira, xatolar), rekvizitlar, akkauntni o'chirish so'rovlari.
'use strict';

(() => {
  const { papi, shell, bind, nav, H } = PLATFORM_UI;
  const P = (method, path, body) => papi('ptoken', method, path, body);
  const load = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); return null; } };
  const stat = (name, v, color) => `<div class="stat"><div class="muted small">${name}</div><div class="v"${color ? ` style="color:var(--${color})"` : ''}>${v}</div></div>`;
  const upTxt = (s) => (s < 3600 ? `${Math.round(s / 60)} daq` : s < 86400 ? `${Math.round(s / 3600)} soat` : `${Math.round(s / 86400)} kun`);
  const LEGAL = [['company', 'Kompaniya (MChJ / YaTT nomi)'], ['inn', 'STIR (INN)'], ['address', 'Yuridik manzil'], ['phone', "Qo'llab-quvvatlash telefoni"],
    ['email', 'E-pochta'], ['telegram', 'Telegram (masalan @fasthub_support)'], ['updated', 'Hujjatlar yangilangan sana (YYYY-MM-DD)']];
  const KIND = { customer: 'Mijoz', courier: 'Kuryer' };

  H.platLaunch = async () => {
    const [s, lg, del] = await Promise.all([load(() => P('GET', '/api/platform/system')), load(() => P('GET', '/api/platform/legal')), load(() => P('GET', '/api/platform/deletions'))]);
    if (!s || !lg) return;
    const done = s.checklist.filter((c) => c.ok).length, bk = s.backups;
    shell('Ishga chiqarish', nav('platLaunch'), `
      <div class="panel"><h3>Tayyorlik: ${done} / ${s.checklist.length}</h3>
        ${s.checklist.map((c) => `<div class="line"><span class="chip ${c.ok ? 'ok' : 'warn'}">${c.ok ? '✓' : '—'}</span><span class="grow">${esc(c.text)}</span></div>`).join('')}
        <p class="muted small">Batafsil qadamlar: <code>docs/LAUNCH.md</code> (server, Play Market, kalitlar).</p></div>
      <div class="grid-stats">${stat('Versiya', esc(s.version))}${stat('Rejim', s.mode === 'cloud' ? 'Bulut' : 'Lokal', s.mode === 'cloud' ? 'accent' : 'warn')}
        ${stat('Ishlayapti', upTxt(s.uptime_s))}${stat('Xotira', s.memory_mb + ' MB')}${stat('Baza', s.db_mb + ' MB')}
        ${stat('Oxirgi zaxira', bk.age_h == null ? "yo'q" : bk.age_h + ' soat oldin', bk.age_h == null || bk.age_h > 26 ? 'danger' : '')}
        ${stat('Tashqi zaxira', bk.offsite ? (bk.offsite.ok ? dt(bk.offsite.at) : 'XATO') : 'sozlanmagan', bk.offsite?.ok ? '' : 'warn')}
        ${stat('Xatolar (ishga tushgandan beri)', s.errors.total, s.errors.total ? 'danger' : '')}</div>
      <div class="panel"><h3>Xizmatlar</h3><div class="row wrap"><span class="chip ${s.services.sms === 'test' ? 'warn' : 'ok'}">SMS: ${esc(s.services.sms)}</span>
        <span class="chip ${s.services.push === 'fcm' ? 'ok' : 'warn'}">Push: ${esc(s.services.push)}</span><span class="chip">Node ${esc(s.node)}</span></div>
        ${bk.offsite && !bk.offsite.ok ? `<div class="note danger" style="margin-top:10px">Tashqi zaxira xatosi: ${esc(bk.offsite.error || '')}</div>` : ''}</div>
      <details class="panel" ${s.errors.total ? 'open' : ''}><summary><b>Oxirgi xatolar</b> (${s.errors.recent.length})</summary><table class="list">
        ${s.errors.recent.map((e) => `<tr><td class="muted small">${dt(e.at)}</td><td class="small">${esc(e.where)}</td><td class="small">${esc(e.message)}</td></tr>`).join('') || '<tr><td class="muted">Xato yo\'q</td></tr>'}</table></details>
      <div class="panel"><h3>Rekvizitlar</h3><p class="muted small">Maxfiylik siyosati, oferta va akkauntni o'chirish sahifalarida ko'rinadi:
        <a href="/legal/privacy" target="_blank">/legal/privacy</a> · <a href="/legal/terms" target="_blank">/legal/terms</a> · <a href="/legal/delete" target="_blank">/legal/delete</a>
        — shu havolalar Google Play'ga kiritiladi. Matnni yurist ko'rib chiqsin.</p>
        <div class="paygrid">${LEGAL.map(([k, n]) => `<div><label>${n}</label><input id="lg-${k}" maxlength="300" value="${esc(lg[k] || '')}"></div>`).join('')}</div>
        <button class="btn primary" style="margin-top:12px" data-p="legalSave">Saqlash</button></div>
      <div class="panel"><h3>Akkauntni o'chirish so'rovlari${s.deletions_pending ? ` <span class="chip warn">${s.deletions_pending} kutmoqda</span>` : ''}</h3>
        <p class="muted small">Mijozlar darhol o'chiriladi. Kuryer hisobida pul yoki depozit qolsa — avval Kuryerlar → Pul orqali hisob-kitob, keyin "O'chirish".</p>
        <table class="list"><tr><th>#</th><th>Turi</th><th>Kim</th><th>Holat</th><th>Sabab</th><th>Sana</th><th></th></tr>
        ${(del || []).map((d) => `<tr><td>${d.id}</td><td>${KIND[d.kind] || d.kind}</td>
          <td>${d.status === 'pending' ? `${esc(d.name || '')} ${esc(fmtPhone(d.phone || ''))}<div class="muted small">balans ${money(d.balance)} · depozit ${money(d.deposit)}</div>` : `<span class="muted">ID ${d.ref_id}</span>`}</td>
          <td>${d.status === 'pending' ? '<span class="chip warn">Hisob-kitob kutmoqda</span>' : '<span class="chip ok">O\'chirildi</span>'}</td><td class="small">${esc(d.reason || '')}</td>
          <td class="muted">${dt(d.done_at || d.requested_at)}</td><td class="right">${d.status === 'pending' ? `<button class="btn sm danger" data-p="delDone" data-id="${d.id}">O'chirish</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="7" class="muted">So\'rov yo\'q</td></tr>'}</table></div>`);
    bind();
  };
  H.legalSave = async () => {
    const body = Object.fromEntries(LEGAL.map(([k]) => [k, $('#lg-' + k).value.trim()]));
    if (await load(() => P('POST', '/api/platform/legal', body))) { toast('Saqlandi'); H.platLaunch(); }
  };
  H.delDone = async (el) => {
    if (!(await confirmBox("Kuryer akkauntini o'chirish", "Ism, telefon va hujjat rasmlari butunlay o'chiriladi.", "O'chirish", true))) return;
    if (await load(() => P('POST', `/api/platform/deletions/${el.dataset.id}/done`))) { toast("O'chirildi"); H.platLaunch(); }
  };
})();
