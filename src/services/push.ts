// Push xabarlar (Firebase Cloud Messaging HTTP v1) — Android va iOS ilovalariga.
// Sozlash: Firebase → Project settings → Service accounts → "Generate new private key" → JSON faylni serverga qo'ying:
//   PUSH_MODE=fcm  FCM_SERVICE_ACCOUNT=/opt/dasturxon/firebase.json
// PUSH_MODE=test — yuborilmaydi, konsolga yoziladi; off (standart) — hech narsa qilmaydi.
import crypto from 'node:crypto';
import fs from 'node:fs';
import '../core/config.ts';

export interface PushMsg { title: string; body: string; data?: Record<string, string | number> }
export interface PushTarget { token: string }
export const MODE = process.env.PUSH_MODE || 'off';
const API = process.env.FCM_API_URL || 'https://fcm.googleapis.com';

let account: { project_id: string; client_email: string; private_key: string; token_uri: string } | null = null;
let access: { token: string; exp: number } | null = null;
function loadAccount() {
  if (account || MODE !== 'fcm') return account;
  const src = process.env.FCM_SERVICE_ACCOUNT || '';
  const raw = src.trim().startsWith('{') ? src : fs.readFileSync(src, 'utf8');
  account = JSON.parse(raw);
  return account;
}
const b64u = (v: Buffer | string) => Buffer.from(v).toString('base64url');
async function accessToken() {
  if (access && access.exp > Date.now() + 60000) return access.token;
  const a = loadAccount()!;
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: a.token_uri, iat, exp: iat + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claim}`), a.private_key).toString('base64url');
  const r = await fetch(a.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  const j: any = await r.json();
  if (!r.ok || !j.access_token) throw new Error('FCM token olinmadi: ' + (j.error_description || r.status));
  access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return access.token;
}

/** Qurilmalarga yuboradi. Qaytaradi: yaroqsiz (o'chirilishi kerak) tokenlar ro'yxati. */
export async function send(targets: PushTarget[], msg: PushMsg): Promise<string[]> {
  if (!targets.length || MODE === 'off') return [];
  if (MODE === 'test') { console.log(`  [Push sinov] ${targets.length} ta qurilma: ${msg.title} — ${msg.body}`); return []; }
  const a = loadAccount()!;
  const token = await accessToken();
  const dead: string[] = [];
  const data = Object.fromEntries(Object.entries(msg.data || {}).map(([k, v]) => [k, String(v)]));
  await Promise.all(targets.map(async (t) => {
    const r = await fetch(`${API}/v1/projects/${a.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: t.token, notification: { title: msg.title, body: msg.body }, data,
        android: { priority: 'high', notification: { sound: 'default', channel_id: 'orders' } }, apns: { payload: { aps: { sound: 'default' } } } } }),
    }).catch(() => null);
    if (r && (r.status === 404 || r.status === 400)) dead.push(t.token); // UNREGISTERED / INVALID_ARGUMENT
  }));
  return dead;
}
