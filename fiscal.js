// Fiskal chek adapteri.
// O'zbekistonda chek faqat Davlat reestridagi onlayn-NKM yoki virtual kassa orqali,
// har bir mahsulotning MXIK (tasnif.soliq.uz) kodi bilan berilishi kerak.
// Provayder (reestrdagi virtual kassa) tanlangach, shu yerga uning API'si ulanadi.
//
// Rejimlar (businesses.fiscal_mode):
//   off   - fiskal yuborilmaydi (sinov / alohida onlayn kassa ishlatilsa)
//   mock  - sinov: soxta fiskal belgi qaytaradi
//   <provayder nomi> - kelajakda: haqiqiy integratsiya

async function register({ business, order, items, payments }) {
  const mode = business.fiscal_mode || 'off';
  if (mode === 'off') return { status: 'skipped', ref: null };
  const missing = items.filter((i) => !i.mxik);
  if (mode === 'mock') {
    return {
      status: missing.length ? 'warning' : 'ok',
      ref: 'MOCK-' + order.id + '-' + Date.now().toString(36).toUpperCase(),
      note: missing.length ? `MXIK kodi yo'q: ${missing.map((i) => i.name).join(', ')}` : undefined,
    };
  }
  // Haqiqiy provayder hali ulanmagan
  return { status: 'not_configured', ref: null, note: `Fiskal provayder "${mode}" ulanmagan` };
}

module.exports = { register };
