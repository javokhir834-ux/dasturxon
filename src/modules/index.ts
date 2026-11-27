// Modullar tartibi muhim: keyingisi oldingilarning funksiyalaridan (ctx.<nom>) foydalanadi.
// Yangi etap = yangi fayl shu papkada + shu ro'yxatga bitta qator.
import type { Ctx } from '../core/context.ts';
import pos from './pos.ts';
import push from './push.ts';
import office from './office.ts';
import staff from './staff.ts';
import tenant from './tenant.ts';
import sync from './sync.ts';
import delivery from './delivery.ts';
import courier from './courier.ts';
import platform from './platform.ts';
import retail from './retail.ts';
import deals from './deals.ts';

const MODULES: [string, (ctx: Ctx) => any][] = [
  ['pos', pos], // 1-etap: POS yadro (natijasi ctx ga yoyiladi: loadOrder, closeOrder, ...)
  ['push', push], // ilovalarga push xabar (qurilma tokenlari)
  ['office', office], // 2-etap: ombor, texkartalar, hisobotlar
  ['staff', staff], // 3-etap: xodimlar, mijozlar, bronlar
  ['tenant', tenant], // 4-etap: bizneslar, obuna, platforma
  ['sync', sync], // 5-etap: lokal ↔ bulut
  ['delivery', delivery], // 6-etap: mijoz ilovasi
  ['courier', courier], // 7-etap: kuryerlar
  ['platform', platform], // 8-etap: platforma admin
  ['retail', retail], // 9-etap: dorixona, do'kon, tez sotuv
  ['deals', deals], // 9-etap: kechki chegirma
];

export function initModules(ctx: Ctx) {
  for (const [name, init] of MODULES) {
    const out = init(ctx);
    if (name === 'pos') Object.assign(ctx, out); else ctx[name] = out;
    if (name === 'delivery') ctx.dlv = out;
  }
  return ctx;
}
