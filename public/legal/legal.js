// Huquqiy sahifalar: platforma rekvizitlarini (/api/legal) [data-l] joylariga qo'yadi; /legal/delete sahifasida akkauntni o'chirish oqimi.
'use strict';
(async () => {
  const $ = (s) => document.querySelector(s);
  try {
    const r = await fetch('/api/legal'); const L = await r.json();
    if (L.updated) L.updated = L.updated.split('-').reverse().join('.');
    document.querySelectorAll('[data-l]').forEach((el) => { el.textContent = L[el.dataset.l] || ''; });
    document.querySelectorAll('a[data-mail]').forEach((a) => { if (L.email) a.href = 'mailto:' + L.email; });
  } catch { /* rekvizitlarsiz ham sahifa o'qiladi */ }

  const form = $('#delForm'); if (!form) return;
  const kind = () => form.querySelector('input[name=kind]:checked').value;
  const show = (text, ok) => { const m = $('#msg'); m.hidden = false; m.className = 'msg ' + (ok ? 'ok' : 'err'); m.textContent = text; };
  const post = async (path, body) => {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Xatolik'); return j;
  };
  const q = new URLSearchParams(location.search); // ilovadan ochilsa: ?kind=courier&phone=...
  if (q.get('kind') === 'courier') form.querySelector('input[value=courier]').checked = true;
  if (q.get('phone')) $('#phone').value = q.get('phone');
  $('#sendCode').onclick = async (e) => {
    e.preventDefault(); const b = e.target; b.disabled = true;
    try {
      const r = await post(kind() === 'courier' ? '/api/k/otp' : '/api/c/otp', { phone: $('#phone').value });
      $('#step2').hidden = false; $('#code').focus();
      show(r.dev_code ? `Sinov rejimi: kod — ${r.dev_code}` : 'Kod SMS orqali yuborildi', true);
      setTimeout(() => { b.disabled = false; }, 60000);
    } catch (err) { b.disabled = false; show(err.message, false); }
  };
  $('#confirm').onclick = async (e) => {
    e.preventDefault();
    if (!confirm("Akkaunt o'chiriladi. Bu amalni qaytarib bo'lmaydi. Davom etamizmi?")) return;
    const b = e.target; b.disabled = true;
    try {
      const r = await post('/api/account/delete', { kind: kind(), phone: $('#phone').value, code: $('#code').value, reason: $('#reason').value });
      show(r.message, true); $('#step2').hidden = true; $('#sendCode').disabled = true;
    } catch (err) { b.disabled = false; show(err.message, false); }
  };
})();
