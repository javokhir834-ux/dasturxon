// Server xatolarini kuzatish: oxirgi 50 ta xato xotirada (platforma paneli → Ishga chiqarish) va Telegram ogohlantirish.
//   ALERT_TG_TOKEN, ALERT_TG_CHAT — platforma egasining boti va chat ID si. Bo'lmasa faqat konsol + panel.
//   Ogohlantirish 5 daqiqada ko'pi bilan 1 marta (xato bo'roni Telegramni to'ldirmasin), orada yig'ilganlar soni bilan.
import './config.ts';

const KEEP = 50, ALERT_GAP_MS = 5 * 60000;
const TG_API = process.env.TG_API || 'https://api.telegram.org';
const started = Date.now();
const recent: { at: string; where: string; message: string }[] = [];
let total = 0, lastAlert = 0, suppressed = 0;

async function alert(text: string) {
  const tok = process.env.ALERT_TG_TOKEN, chat = process.env.ALERT_TG_CHAT;
  if (!tok || !chat) return false;
  try {
    const r = await fetch(`${TG_API}/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3500) }), signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

/** Xatoni yozib qo'yish (5xx, ushlanmagan istisnolar) */
function record(e: unknown, where = '') {
  const message = e instanceof Error ? e.message : String(e);
  total++;
  recent.unshift({ at: new Date().toISOString(), where, message: message.slice(0, 500) });
  recent.length = Math.min(recent.length, KEEP);
  if (Date.now() - lastAlert < ALERT_GAP_MS) { suppressed++; return; }
  lastAlert = Date.now();
  const extra = suppressed ? `\n(+${suppressed} ta xato oldingi xabardan keyin)` : '';
  suppressed = 0;
  void alert(`⚠️ FastHub server xatosi\n${where}\n${message}${extra}`);
}

const status = () => ({ total, recent, uptime_s: Math.round((Date.now() - started) / 1000), alerts: !!(process.env.ALERT_TG_TOKEN && process.env.ALERT_TG_CHAT) });

export { record, status, alert };
