// Sozlamalar: .env fayli (ixtiyoriy) + muhit o'zgaruvchilari. Tashqi paketsiz.
//   MODE=local|cloud     local — restoran kompyuteri (standart), cloud — internetdagi server (HTTPS ortida)
//   HOST=0.0.0.0         cloud rejimda 127.0.0.1 (faqat Caddy/nginx orqali)
//   PORT=8080
//   DATA_DIR=./data
//   TRUST_PROXY=1        IP manzilni X-Forwarded-For dan olish (faqat proksi ortida)
//   PLATFORM_PASSWORD=   platforma paneli paroli
//   RATE_LIMIT=600       bitta IP dan daqiqasiga so'rovlar
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Loyiha ildizi (src/ ning ota papkasi) */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const MODE: Mode = process.env.MODE === 'cloud' ? 'cloud' : 'local';
export type Mode = 'local' | 'cloud';
const config = {
  MODE,
  HOST: process.env.HOST || (MODE === 'cloud' ? '127.0.0.1' : '0.0.0.0'),
  PORT: Number(process.env.PORT) || 8080,
  TRUST_PROXY: process.env.TRUST_PROXY === '1' || MODE === 'cloud',
  RATE_LIMIT: Number(process.env.RATE_LIMIT) || 600,
};
export default config;
