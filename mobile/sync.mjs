// www ni native loyihalarga ko'chiradi (npx cap sync) va ruxsatlarni (Android manifest, iOS Info.plist) qo'yadi.
// Ishlatish: node sync.mjs [mijoz|kuryer|biznes] [android|ios]   (oldin: node build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APPS } from './build.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PERMS = {
  common: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'],
  mijoz: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'],
  kuryer: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_LOCATION', 'android.permission.WAKE_LOCK'],
  biznes: [],
};
const PLIST = {
  common: { NSCameraUsageDescription: "Rasm olish uchun (hujjat, buyurtma, mahsulot)", NSPhotoLibraryUsageDescription: 'Rasm tanlash uchun' },
  mijoz: { NSLocationWhenInUseUsageDescription: 'Yetkazish manzilini aniqlash uchun' },
  kuryer: { NSLocationWhenInUseUsageDescription: "Yaqin buyurtmalarni taklif qilish va mijozga yo'lni ko'rsatish uchun",
    NSLocationAlwaysAndWhenInUseUsageDescription: "Liniyada bo'lganingizda ilova yopiq bo'lsa ham buyurtma kelishi uchun", UIBackgroundModes: ['location', 'remote-notification'] },
  biznes: {},
};

function patchAndroid(name, root) {
  const f = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  let x = fs.readFileSync(f, 'utf8');
  for (const p of [...PERMS.common, ...PERMS[name]]) if (!x.includes(`"${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  if (name === 'kuryer' && !x.includes('android.hardware.location.gps')) x = x.replace('</manifest>', '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>');
  if (!x.includes('usesCleartextTraffic')) x = x.replace('<application', '<application\n        android:usesCleartextTraffic="true"'); // lokal tarmoqdagi http server uchun
  fs.writeFileSync(f, x);
}
function patchIos(name, root) {
  const f = path.join(root, 'ios', 'App', 'App', 'Info.plist');
  if (!fs.existsSync(f)) return;
  let x = fs.readFileSync(f, 'utf8');
  const add = { ...PLIST.common, ...PLIST[name], NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } };
  for (const [k, v] of Object.entries(add)) {
    if (x.includes(`<key>${k}</key>`)) continue;
    const val = Array.isArray(v) ? `<array>${v.map((s) => `<string>${s}</string>`).join('')}</array>`
      : typeof v === 'object' ? `<dict>${Object.entries(v).map(([a, b]) => `<key>${a}</key><${b ? 'true' : 'false'}/>`).join('')}</dict>` : `<string>${v}</string>`;
    x = x.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${k}</key>\n\t${val}\n</dict>\n</plist>\n`);
  }
  fs.writeFileSync(f, x);
}

const [only, platform] = process.argv.slice(2);
for (const name of only && APPS[only] ? [only] : Object.keys(APPS)) {
  const root = path.join(DIR, 'apps', name);
  execSync(`npx cap sync ${platform || ''}`.trim(), { cwd: root, stdio: 'inherit' });
  if (!platform || platform === 'android') patchAndroid(name, root);
  if (!platform || platform === 'ios') patchIos(name, root);
  console.log(`✓ ${name} sinxronlandi`);
}
