// Hamkorlikka qabul: biznes va kuryer so'rovnomasi (ariza), maxfiylik siyosati va shartlar bo'yicha "o'qidi va rozi" testi, biznes arizasini platforma tasdiqlashi.
// Rozilik: kim (biznes/kuryer), qaysi hujjat versiyasi, natija, IP, vaqt — `consents` jadvalida (nizolarda isbot).
// Biznes: bulut rejimida (yoki platforma sozlamasi require_approval=1) ariza tasdiqlanmaguncha panelga kirib bo'lmaydi va mijoz ilovasida ko'rinmaydi.
import type { Ctx } from '../core/context.ts';

const PLACE_TYPES = ['restoran', 'milliy', 'fastfood', 'pizza', 'sushi', 'kafe', 'choyxona', 'shirinlik', 'nonvoyxona', 'dorixona', 'dokon'];
const DISTRICTS = ['Navoiy shahri', 'Karmana', 'Zarafshon', 'Uchquduq', 'Nurota', 'Qiziltepa', 'Xatirchi', 'Navbahor', 'Konimex', 'Tomdi', 'Boshqa'];
const SLOTS = ['ertalab', 'kunduzi', 'kechqurun', 'tunda'];

// Hujjatdan asosiy qoidalar (ilovada ko'rsatiladi) va tushunganini tekshiruvchi savollar: [savol, variantlar, to'g'ri javob]
const POINTS: Record<string, string[]> = {
  courier: [
    "Joylashuvingiz faqat \"Ishdaman\" rejimi yoqilganda yuboriladi — buyurtma taklif qilish va mijozga kuryer qayerdaligini ko'rsatish uchun.",
    "Pasport, selfi va guvohnoma rasmlarini faqat platformaning vakolatli xodimi ko'radi.",
    "Mijozning ismi, telefoni va manzili faqat shu buyurtmani yetkazish uchun beriladi — saqlash, boshqalarga berish taqiqlanadi.",
    "Olgan naqdni 24 soat ichida topshirasiz; mijozdan 4 xonali kodsiz buyurtma berilmaydi.",
    "Akkauntni ilovada (Profil → Akkauntni o'chirish) yoki veb sahifada o'chirasiz; hisobda pul qolsa — hisob-kitobdan keyin o'chiriladi.",
  ],
  business: [
    "Mijozning ismi, telefoni va manzili faqat buyurtmani bajarish uchun beriladi — reklama yoki boshqa maqsadda ishlatish taqiqlanadi.",
    "Mahsulot sifati, tarkibi va fiskal chek uchun hamkor (biznes) javob beradi; platforma buyurtma va yetkazishni tashkil qiladi.",
    "Dorixonalar ilovada faqat retseptsiz dori vositalarini sotadi; litsenziya platforma tomonidan tekshiriladi.",
    "Mahsulot tugasa — mijoz tanlagan usulda: o'xshashiga almashtirish, olib tashlash (pul qaytariladi) yoki qo'ng'iroq.",
    "Komissiya, kafolat fondi va hisob-kitob oferta va hisob-kitob aktlarida ko'rsatiladi; nizolar isbotlar asosida hal qilinadi.",
  ],
};
const QUIZ: Record<string, [string, string[], number][]> = {
  courier: [
    ["Joylashuvingiz qachon platformaga yuboriladi?", ['Har doim, ilova yopiq bo\'lsa ham', "Faqat \"Ishdaman\" rejimi yoqilganda", 'Hech qachon'], 1],
    ['Pasport va selfi rasmlaringizni kim ko\'radi?', ['Barcha mijozlar', 'Faqat platformaning vakolatli xodimi', 'Restoranlar'], 1],
    ["Mijozning telefoni va manzili bilan nima qilish mumkin?", ['Faqat shu buyurtmani yetkazish uchun ishlatish', "Keyinroq reklama uchun saqlab qo'yish", "Do'stlarga berish"], 0],
    ['Mijoz 4 xonali kodni aytmasa-chi?', ['Baribir beraman', "Kodsiz buyurtma berilmaydi — qo'ng'iroq qilaman", 'Eshik oldida qoldirib ketaman'], 1],
    ["Akkauntni o'chirsam, hisobimda pul qolgan bo'lsa?", ["Darhol o'chadi, pul yo'qoladi", "Hisob-kitobdan keyin o'chiriladi", "Hech qachon o'chirib bo'lmaydi"], 1],
  ],
  business: [
    ['Mijozning ismi, telefoni va manzili nima uchun beriladi?', ['Faqat buyurtmani bajarish uchun', 'Reklama SMS yuborish uchun', 'Boshqa kompaniyalarga sotish uchun'], 0],
    ['Mahsulot sifati va fiskal chek uchun kim javob beradi?', ['Platforma', 'Hamkor — biznesning o\'zi', 'Kuryer'], 1],
    ['Dorixona ilovada nimani sotishi mumkin?', ['Faqat retseptsiz dori vositalarini', 'Barcha dorilarni', "Retseptli dorilarni ham, mijoz so'rasa"], 0],
    ['Buyurtmadagi mahsulot tugab qolsa nima qilasiz?', ["O'zimiz xohlagan narsani qo'shamiz", "Mijoz tanlagan usulda: almashtirish, olib tashlash yoki qo'ng'iroq", 'Buyurtmani indamay bekor qilamiz'], 1],
    ['Komissiya va hisob-kitob qayerda ko\'rsatilgan?', ["Hech qayerda", 'Oferta va hisob-kitob aktlarida', "Faqat og'zaki kelishuvda"], 1],
  ],
};

export default function onboarding(ctx: Ctx) {
  const { db, route, fail, now, z, clientIp, tenant, dlv, config } = ctx;
  // So'rovnoma xatosi foydalanuvchiga tushunarli bo'lsin: maxsus o'zbekcha xabar bo'lsa — o'shani, aks holda maydon nomi bilan
  const LABELS: Record<string, string> = { place_type: 'Biznes turi', legal_form: 'Yuridik shakl', legal_name: 'Yuridik nom', inn: 'STIR', address: 'Manzil', work_hours: 'Ish vaqti',
    own_couriers: "O'z kuryerlari", staff_count: 'Xodimlar soni', daily_orders: 'Kunlik buyurtmalar', license_no: 'Litsenziya', note: 'Izoh', birth_year: "Tug'ilgan yil",
    district: 'Hudud', availability: 'Ish vaqtlari', experience: 'Tajriba', smartphone_gps: 'Smartfon', answers: 'Javoblar', agree: 'Rozilik' };
  function parse<T extends import('zod').ZodType>(schema: T, data: unknown): import('zod').infer<T> {
    const r = schema.safeParse(data ?? {});
    if (r.success) return r.data;
    const i = r.error.issues[0], key = String(i.path[0] ?? '');
    const generic = /^(Invalid|Too |Expected|Required)/.test(i.message);
    return fail(400, generic ? `${LABELS[key] || key || "Ma'lumot"}: ${i.code === 'invalid_type' ? 'kiritilmagan' : "noto'g'ri"}` : i.message);
  }
  db.exec(`
  CREATE TABLE IF NOT EXISTS consents (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, version TEXT NOT NULL, score INTEGER, total INTEGER,
    answers TEXT, ip TEXT, at TEXT);
  CREATE INDEX IF NOT EXISTS idx_consents ON consents(kind, ref_id);
  CREATE TABLE IF NOT EXISTS applications (kind TEXT NOT NULL, ref_id INTEGER NOT NULL, data TEXT NOT NULL, at TEXT, PRIMARY KEY (kind, ref_id));
  `);
  // Mavjud bizneslar tasdiqlangan hisoblanadi (DEFAULT), yangilari — ariza bilan
  for (const c of ["approval TEXT DEFAULT 'approved'", "approval_note TEXT DEFAULT ''", 'applied_at TEXT', 'approved_at TEXT']) { try { db.exec(`ALTER TABLE businesses ADD COLUMN ${c}`); } catch { /* bor */ } }

  // Hujjat versiyasi — rekvizitlardagi "yangilangan" sana (yo'q bo'lsa — birinchi tahrir)
  const version = () => db.prepare("SELECT value FROM platform_settings WHERE key='legal_updated'").get()?.value || '2026-11-27';
  const approvalRequired = () => {
    const v = db.prepare("SELECT value FROM platform_settings WHERE key='require_approval'").get()?.value;
    return v != null ? v === '1' : config.MODE === 'cloud';
  };
  const consentOf = (kind: string, id: number) => db.prepare('SELECT * FROM consents WHERE kind=? AND ref_id=? ORDER BY id DESC LIMIT 1').get(kind, id) || null;
  const appOf = (kind: string, id: number) => { const r = db.prepare('SELECT data, at FROM applications WHERE kind=? AND ref_id=?').get(kind, id); return r ? { ...JSON.parse(r.data), at: r.at } : null; };
  const saveApp = (kind: string, id: number, data: object) => db.prepare('INSERT INTO applications (kind,ref_id,data,at) VALUES (?,?,?,?) ON CONFLICT(kind,ref_id) DO UPDATE SET data=excluded.data, at=excluded.at')
    .run(kind, id, JSON.stringify(data), now());

  /** Rozilik testini tekshiradi: hammasi to'g'ri va "roziman" belgisi bo'lishi shart */
  function grade(kind: 'courier' | 'business', body) {
    const b = parse(z.object({ answers: z.array(z.number().int()).length(QUIZ[kind].length, 'Hamma savolga javob bering'), agree: z.literal(true, { message: 'Shartlarga rozilikni belgilang' }) }), body || {});
    const wrong = QUIZ[kind].map(([, , r], i) => (b.answers[i] === r ? null : i)).filter((x) => x != null) as number[];
    return { answers: b.answers, wrong, score: QUIZ[kind].length - wrong.length, total: QUIZ[kind].length };
  }
  const record = (kind: string, id: number, g, ip: string) =>
    db.prepare('INSERT INTO consents (kind,ref_id,version,score,total,answers,ip,at) VALUES (?,?,?,?,?,?,?,?)').run(kind, id, version(), g.score, g.total, JSON.stringify(g.answers), ip, now());
  const quizView = (kind: string) => ({ version: version(), points: POINTS[kind], questions: QUIZ[kind].map(([q, a]) => ({ q, a })) });
  route('GET', '/api/onboarding/:kind', null, ({ p }) => (POINTS[p.kind] ? { ...quizView(p.kind), approval_required: approvalRequired() } : fail(404, 'Topilmadi')));

  // ---------- Biznes ----------
  const bizApp = z.object({
    place_type: z.enum(PLACE_TYPES as [string, ...string[]], { message: 'Biznes turini tanlang' }),
    legal_form: z.enum(['yatt', 'mchj'], { message: 'YaTT yoki MChJ ni tanlang' }),
    legal_name: z.string().trim().min(2, 'Yuridik nomni yozing').max(120),
    inn: z.string().trim().regex(/^(\d{9}|\d{14})$/, "STIR 9 xonali (yoki JShShIR 14 xonali) bo'lsin"),
    address: z.string().trim().min(5, "Manzilni to'liq yozing").max(200),
    work_hours: z.string().trim().min(3, 'Ish vaqtini yozing').max(60),
    own_couriers: z.boolean(),
    staff_count: z.number().int().min(1, 'Xodimlar sonini yozing').max(1000),
    daily_orders: z.number().int().min(0).max(100000),
    license_no: z.string().trim().max(60).optional().default(''),
    note: z.string().trim().max(500).optional().default(''),
  }).refine((a) => a.place_type !== 'dorixona' || a.license_no.length >= 3, { message: 'Dorixona uchun litsenziya raqamini yozing', path: ['license_no'] });

  /** /api/register (tenant.ts) dan: biznes yaratilishidan OLDIN — so'rovnoma va rozilik tekshiriladi */
  function checkBusiness(body) {
    const app = parse(bizApp, body.application || {});
    const g = grade('business', body.consent);
    if (g.wrong.length) fail(400, `Maxfiylik va shartlar savollarida xato: ${g.wrong.map((i) => i + 1).join(', ')}-savol. Qoidalarni qayta o'qing`);
    return { app, g };
  }
  /** Biznes yaratilgandan KEYIN: ariza va rozilik saqlanadi, kerak bo'lsa tasdiq kutadi */
  function saveBusiness(bizId: number, { app, g }, ip: string) {
    saveApp('business', bizId, app); record('business', bizId, g, ip);
    db.prepare('UPDATE businesses SET approval=?, applied_at=?, address=COALESCE(NULLIF(address,\'\'), ?) WHERE id=?').run(approvalRequired() ? 'pending' : 'approved', now(), app.address, bizId);
    if (!approvalRequired()) applyToDelivery(bizId, app);
    return approvalRequired() ? 'pending' : 'approved';
  }
  function applyToDelivery(bizId: number, app) { // turi va manzili yetkazish sozlamalariga (restoran keyin o'zgartira oladi)
    db.prepare(`INSERT INTO delivery_settings (business_id, place_type, address) VALUES (?,?,?)
      ON CONFLICT(business_id) DO UPDATE SET place_type=excluded.place_type, address=CASE WHEN address='' THEN excluded.address ELSE address END`).run(bizId, app.place_type, app.address);
    if (app.place_type === 'dorixona' && app.license_no) try { db.prepare('UPDATE delivery_settings SET license_no=? WHERE business_id=?').run(app.license_no, bizId); } catch { /* ustun yo'q */ }
  }
  const approvalOf = (b: number) => db.prepare('SELECT approval, approval_note FROM businesses WHERE id=?').get(b) || { approval: 'approved', approval_note: '' };

  // Panelga kirish: ariza tasdiqlanmagan bo'lsa — yopiq
  const prevLogin = tenant.assertLoginAllowed;
  tenant.assertLoginAllowed = (b: number) => {
    const a = approvalOf(b);
    if (a.approval === 'pending') fail(403, "Arizangiz tekshirilmoqda. Platforma tasdiqlagach kirasiz (odatda 1 ish kuni)");
    if (a.approval === 'rejected') fail(403, `Ariza rad etildi: ${a.approval_note || "platforma bilan bog'laning"}`);
    prevLogin(b);
  };
  // Mijoz ilovasi: tasdiqlanmagan biznes ko'rinmaydi
  const prevPlace = dlv.ext.placeAllowed;
  dlv.ext.placeAllowed = (b: number) => approvalOf(b).approval === 'approved' && prevPlace(b);

  route('GET', '/api/platform/applications', null, ({ req }) => {
    tenant.platAuth(req);
    return db.prepare(`SELECT b.id, b.name, b.code, b.phone, b.approval, b.approval_note, b.applied_at, b.approved_at, o.name owner_name, o.phone owner_phone
      FROM businesses b LEFT JOIN owners o ON o.id=b.owner_id WHERE b.applied_at IS NOT NULL ORDER BY b.approval='pending' DESC, b.id DESC LIMIT 200`).all()
      .map((b) => ({ ...b, application: appOf('business', b.id), consent: consentOf('business', b.id) }));
  });
  route('POST', '/api/platform/applications/:id', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const b = parse(z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional().default('') }), body);
    const biz = db.prepare('SELECT id, approval FROM businesses WHERE id=?').get(Number(p.id)) || fail(404, 'Biznes topilmadi');
    if (b.action === 'reject' && !b.note) fail(400, 'Rad etish sababini yozing');
    if (b.action === 'approve') {
      db.prepare("UPDATE businesses SET approval='approved', approval_note='', approved_at=? WHERE id=?").run(now(), biz.id);
      // Sinov muddati tasdiqlangan kundan boshlanadi
      const days = Number(tenant.setting('trial_days')) || 14, until = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
      db.prepare('UPDATE subscriptions SET paid_until=? WHERE business_id=? AND trial=1').run(until, biz.id);
      const app = appOf('business', biz.id); if (app) applyToDelivery(biz.id, app);
    } else db.prepare("UPDATE businesses SET approval='rejected', approval_note=? WHERE id=?").run(b.note, biz.id);
    db.prepare('INSERT INTO platform_log (action,entity,entity_id,details,at) VALUES (?,?,?,?,?)').run('business_' + b.action, 'business', biz.id, JSON.stringify({ note: b.note }), now());
    return { ok: true, approval: b.action === 'approve' ? 'approved' : 'rejected' };
  });

  // ---------- Kuryer ----------
  const courierApp = z.object({
    birth_year: z.number().int().min(1940).max(new Date().getFullYear() - 18, "Kuryer 18 yoshdan katta bo'lishi kerak"),
    district: z.enum(DISTRICTS as [string, ...string[]], { message: 'Hududni tanlang' }),
    availability: z.array(z.enum(SLOTS as [string, ...string[]])).min(1, 'Qaysi vaqtda ishlashingizni belgilang'),
    experience: z.boolean(),
    smartphone_gps: z.literal(true, { message: "Ishlash uchun GPS li smartfon kerak" }),
  });
  const courierAuth = (req) => {
    const h = req.headers.authorization || ''; const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const s = t && db.prepare('SELECT courier_id FROM courier_sessions WHERE token_hash=?').get(ctx.tokHash(t));
    const c = s && db.prepare('SELECT * FROM couriers WHERE id=?').get(s.courier_id);
    if (!c) fail(401, 'Telefon orqali kiring');
    if (!['draft', 'rejected'].includes(c.status)) fail(409, "Ariza yuborilgan — o'zgartirib bo'lmaydi");
    return c;
  };
  route('POST', '/api/k/application', null, ({ req, body }) => {
    const c = courierAuth(req); saveApp('courier', c.id, parse(courierApp, body)); return { ok: true };
  });
  route('POST', '/api/k/consent', null, ({ req, body }) => {
    const c = courierAuth(req); const g = grade('courier', body);
    if (!g.wrong.length) record('courier', c.id, g, clientIp(req));
    return { passed: !g.wrong.length, score: g.score, total: g.total, wrong: g.wrong };
  });
  /** Ariza yuborishdan oldin yetishmayotgan qadam (courier.ts /api/k/submit) */
  const courierMissing = (id: number) => (!appOf('courier', id) ? "Avval so'rovnomani to'ldiring" : !consentOf('courier', id) ? "Avval maxfiylik va shartlar bo'yicha savollarga javob bering" : null);
  const courierFlags = (id: number) => ({ application_done: !!appOf('courier', id), consent_done: !!consentOf('courier', id) });

  return { checkBusiness, saveBusiness, approvalOf, courierMissing, courierFlags, appOf, consentOf, DISTRICTS, SLOTS };
}
