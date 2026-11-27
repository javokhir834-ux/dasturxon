// Dasturxon serveri. Ishga tushirish: npm start  (yoki: node src/server.ts). Sozlamalar: .env (src/core/config.ts).
import os from 'node:os';
import config from './core/config.ts';
import { db } from './core/db.ts';
import { buildApp } from './app.ts';
import * as monitor from './core/monitor.ts';

// Ushlanmagan xatolar: panelga yoziladi va Telegramga ogohlantirish ketadi; istisnodan keyin jarayon to'xtaydi (systemd qayta ishga tushiradi)
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e); monitor.record(e, 'unhandledRejection'); });
process.on('uncaughtException', (e) => {
  console.error('uncaughtException:', e);
  void monitor.alert(`🛑 FastHub server to'xtadi\n${e.message}`).finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000).unref();
});

const { app } = buildApp();
await app.listen({ port: config.PORT, host: config.HOST });

const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n!.address);
console.log(`\n  FastHub ishga tushdi (${config.MODE === 'cloud' ? 'BULUT rejimi' : 'lokal rejim'})\n  Shu kompyuterda:   http://localhost:${config.PORT}`);
if (config.MODE !== 'cloud') ips.forEach((ip) => console.log(`  Planshet/telefon:  http://${ip}:${config.PORT}`));
for (const b of db.prepare('SELECT name, code FROM businesses ORDER BY id LIMIT 5').all()) console.log(`  Biznes: ${b.name} — kod ${b.code}`);
console.log('\n  Namuna PINlar: Admin 1111 | Kassir 2222 | Ofitsiant 3333 | Oshpaz 4444');
console.log("  Ro'yxatdan o'tish: /#register · Ega kabineti: /#owner · Platforma: /#platform\n");

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { app.close().finally(() => process.exit(0)); });
