// Mobil ilovalar uchun veb qismini yig'adi: ../public → apps/<ilova>/www (+ ishga tushirish ekrani, sozlama, capacitor.config.json).
// Ishlatish: node build.mjs [mijoz|kuryer|biznes]   (bo'sh — hammasi)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, '..', 'public');
const brand = JSON.parse(fs.readFileSync(path.join(DIR, 'brand.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'package.json'), 'utf8'));

export const APPS = {
  mijoz: { id: 'app', title: brand.name, entry: '/app/index.html' },
  kuryer: { id: 'courier', title: `${brand.name} Kuryer`, entry: '/courier/index.html', backgroundGps: true },
  biznes: { id: 'business', title: `${brand.name} Biznes`, entry: '/pos.html' },
};

export function buildApp(name) {
  const a = APPS[name]; if (!a) throw new Error(`Noma'lum ilova: ${name}`);
  const root = path.join(DIR, 'apps', name), www = path.join(root, 'www');
  fs.rmSync(www, { recursive: true, force: true });
  fs.cpSync(PUBLIC, www, { recursive: true });
  // Biznes ilovasida POS sahifasi pos.html, ildizda — ishga tushirish ekrani
  fs.renameSync(path.join(www, 'index.html'), path.join(www, 'pos.html'));
  fs.copyFileSync(path.join(DIR, 'launcher', 'index.html'), path.join(www, 'index.html'));
  fs.copyFileSync(path.join(DIR, 'launcher', 'launcher.js'), path.join(www, 'launcher.js'));
  const cfg = { app: name, name: brand.name, appName: a.title, entry: a.entry, server: brand.server || '', push: !!brand.push, backgroundGps: !!a.backgroundGps, version: pkg.version };
  fs.writeFileSync(path.join(www, 'dx-config.js'), `window.DX_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`);
  const cap = {
    appId: `${brand.idPrefix}.${a.id}`, appName: a.title, webDir: 'www',
    server: { androidScheme: 'https', cleartext: true },
    android: { allowMixedContent: true, backgroundColor: brand.color },
    ios: { backgroundColor: brand.color, contentInset: 'always' },
    plugins: { PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] } },
  };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(cap, null, 2) + '\n');
  return { root, cap };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(APPS);
  for (const n of names) { const { cap } = buildApp(n); console.log(`✓ ${n}: ${cap.appName} (${cap.appId})`); }
}
