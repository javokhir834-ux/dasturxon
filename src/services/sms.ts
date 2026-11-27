import '../core/config.ts'; // .env avval yuklansin
// SMS yuborish adapteri.
//   SMS_MODE=test (standart) — kod server konsoliga yoziladi va API javobida `dev_code` sifatida qaytadi (faqat sinov uchun!).
//   SMS_MODE=eskiz — Eskiz.uz (https://notify.eskiz.uz): ESKIZ_EMAIL, ESKIZ_PASSWORD, ESKIZ_FROM (jo'natuvchi nomi, standart 4546).
//     Eskiz faqat kabinetda tasdiqlangan shablon matnini yuboradi — "FastHub tasdiqlash kodi: {kod}" shablonini u yerda ro'yxatdan o'tkazing.
//     ESKIZ_URL — API manzilini almashtirish (testlarda soxta server).
const MODE = process.env.SMS_MODE || 'test';
const ESKIZ = (process.env.ESKIZ_URL || 'https://notify.eskiz.uz/api').replace(/\/$/, '');
const TOKEN_DAYS = 25; // Eskiz tokeni 30 kun yashaydi — biroz oldinroq yangilaymiz

type Result = { ok: boolean; test?: boolean; id?: string; reason?: string };
let token = '', tokenAt = 0;

async function post(path: string, fields: Record<string, string>, auth = '') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const r = await fetch(ESKIZ + path, { method: 'POST', body: form, headers: auth ? { Authorization: 'Bearer ' + auth } : {}, signal: AbortSignal.timeout(10000) });
  return { status: r.status, j: await r.json().catch(() => ({})) as Record<string, any> };
}

async function eskizToken(force: boolean) {
  if (token && !force && Date.now() - tokenAt < TOKEN_DAYS * 864e5) return token;
  const { status, j } = await post('/auth/login', { email: process.env.ESKIZ_EMAIL || '', password: process.env.ESKIZ_PASSWORD || '' });
  if (status !== 200 || !j.data?.token) throw new Error(`Eskiz login: ${j.message || 'HTTP ' + status}`);
  token = j.data.token; tokenAt = Date.now();
  return token;
}

async function eskizSend(phone: string, text: string): Promise<Result> {
  for (const retry of [false, true]) {
    const { status, j } = await post('/message/sms/send', { mobile_phone: phone, message: text, from: process.env.ESKIZ_FROM || '4546' }, await eskizToken(retry));
    if (status === 401 && !retry) continue; // token muddatidan oldin bekor bo'lgan — bir marta qayta kiramiz
    if (status >= 300) return { ok: false, reason: `Eskiz: ${j.message || 'HTTP ' + status}` };
    return { ok: true, id: String(j.id || '') };
  }
  return { ok: false, reason: 'Eskiz: avtorizatsiya xatosi' };
}

async function send(phone: string, text: string): Promise<Result> {
  if (MODE === 'test') {
    console.log(`  [SMS sinov] ${phone}: ${text}`);
    return { ok: true, test: true };
  }
  try {
    if (MODE === 'eskiz') return await eskizSend(phone, text);
  } catch (e) {
    console.error('SMS xatosi:', e.message);
    return { ok: false, reason: 'SMS xizmati javob bermadi' };
  }
  return { ok: false, reason: `SMS provayder "${MODE}" ulanmagan` };
}

export { send, MODE };
