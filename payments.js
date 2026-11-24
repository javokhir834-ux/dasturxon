// Onlayn to'lov provayderlari: test (sinov), Payme (Merchant API, JSON-RPC), Click (SHOP-API Prepare/Complete).
// Qoida: imzo/autentifikatsiya avval, baza keyin; har bir callback idempotent; summalar Payme'da tiyinda, Click'da so'mda.
// Kalitlar (muhit o'zgaruvchilari): PAYME_MERCHANT_ID, PAYME_KEY, PAYME_TEST=1 | CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_SECRET_KEY.
// Kalitlar bo'lmasa — faqat "test" provayderi ishlaydi (haqiqiy pul yechilmaydi).
const crypto = require('crypto');

module.exports = function payments({ db, route, getOrder, onPaid, onCancelled }) {
  db.exec(`CREATE TABLE IF NOT EXISTS payment_tx (
    id INTEGER PRIMARY KEY, provider TEXT NOT NULL, ext_id TEXT NOT NULL, order_id INTEGER NOT NULL, amount INTEGER NOT NULL,
    state INTEGER DEFAULT 1, ext_time INTEGER, create_time INTEGER, perform_time INTEGER DEFAULT 0, cancel_time INTEGER DEFAULT 0, reason INTEGER,
    UNIQUE(provider, ext_id))`);
  const env = process.env;
  const enabled = { payme: !!(env.PAYME_MERCHANT_ID && env.PAYME_KEY), click: !!(env.CLICK_SERVICE_ID && env.CLICK_MERCHANT_ID && env.CLICK_SECRET_KEY) };
  const providers = () => [...(enabled.click ? ['click'] : []), ...(enabled.payme ? ['payme'] : []), ...(!enabled.click && !enabled.payme ? ['test'] : [])];

  function checkoutUrl(order, provider, returnUrl) {
    if (provider === 'payme') {
      const base = env.PAYME_TEST === '1' ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz';
      return `${base}/${Buffer.from(`m=${env.PAYME_MERCHANT_ID};ac.order_id=${order.id};a=${order.prepay_amount * 100};c=${returnUrl}`).toString('base64')}`;
    }
    if (provider === 'click') {
      return `https://my.click.uz/services/pay?service_id=${env.CLICK_SERVICE_ID}&merchant_id=${env.CLICK_MERCHANT_ID}&amount=${order.prepay_amount}&transaction_param=${order.id}&return_url=${encodeURIComponent(returnUrl)}`;
    }
    return `/app/#pay/${order.id}`; // test
  }

  // ---------- Payme ----------
  const TIMEOUT = 12 * 3600 * 1000;
  const msg = (uz, ru) => ({ uz, ru, en: uz });
  class PaymeError extends Error { constructor(code, m, data) { super(m?.uz || String(code)); this.code = code; this.m = m; this.data = data; } }
  const pErr = (code, m, data) => { throw new PaymeError(code, m, data); };
  const txOut = (t) => ({ transaction: String(t.id), state: t.state, create_time: t.create_time, perform_time: t.perform_time, cancel_time: t.cancel_time });
  function paymeAuth(req) {
    const h = req.headers.authorization || '';
    const expected = 'Basic ' + Buffer.from(`Paycom:${env.PAYME_KEY}`).toString('base64');
    const a = Buffer.from(h), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  function paymeOrder(params) {
    const id = Number(params?.account?.order_id);
    const o = Number.isInteger(id) ? getOrder(id) : null;
    if (!o) pErr(-31050, msg('Buyurtma topilmadi', 'Заказ не найден'), 'order_id');
    if (o.status !== 'awaiting_payment' || o.payment_status === 'paid') pErr(-31051, msg("Buyurtmani to'lab bo'lmaydi", 'Заказ нельзя оплатить'), 'order_id');
    if (Number(params.amount) !== o.prepay_amount * 100) pErr(-31001, msg("Summa noto'g'ri", 'Неверная сумма'));
    return o;
  }
  const getTx = (id) => db.prepare("SELECT * FROM payment_tx WHERE provider='payme' AND ext_id=?").get(String(id));
  function cancelTx(t, state, reason) {
    const ct = Date.now();
    db.prepare('UPDATE payment_tx SET state=?, cancel_time=?, reason=? WHERE id=?').run(state, ct, reason, t.id);
    return { ...t, state, cancel_time: ct, reason };
  }
  const PAYME = {
    CheckPerformTransaction(p) { paymeOrder(p); return { allow: true }; },
    CreateTransaction(p) {
      const ex = getTx(p.id);
      if (ex) {
        if (ex.state !== 1) pErr(-31008, msg("Amalni bajarib bo'lmaydi", 'Невозможно выполнить операцию'));
        if (Date.now() - ex.create_time > TIMEOUT) { cancelTx(ex, -1, 4); pErr(-31008, msg("Tranzaksiya muddati o'tgan", 'Истек срок транзакции')); }
        return txOut(ex);
      }
      const o = paymeOrder(p);
      const busy = db.prepare("SELECT id FROM payment_tx WHERE provider='payme' AND order_id=? AND state=1").get(o.id);
      if (busy) pErr(-31050, msg("Buyurtma boshqa tranzaksiyada kutilmoqda", 'Заказ ожидает другую транзакцию'), 'order_id');
      const ct = Date.now();
      const id = db.prepare("INSERT INTO payment_tx (provider,ext_id,order_id,amount,state,ext_time,create_time) VALUES ('payme',?,?,?,1,?,?)").run(String(p.id), o.id, Number(p.amount), Number(p.time) || ct, ct).lastInsertRowid;
      return txOut(db.prepare('SELECT * FROM payment_tx WHERE id=?').get(id));
    },
    PerformTransaction(p) {
      const t = getTx(p.id) || pErr(-31003, msg('Tranzaksiya topilmadi', 'Транзакция не найдена'));
      if (t.state === 2) return txOut(t);
      if (t.state !== 1) pErr(-31008, msg("Amalni bajarib bo'lmaydi", 'Невозможно выполнить операцию'));
      if (Date.now() - t.create_time > TIMEOUT) { cancelTx(t, -1, 4); onCancelled(t.order_id, false); pErr(-31008, msg("Tranzaksiya muddati o'tgan", 'Истек срок транзакции')); }
      const pt = Date.now();
      db.prepare('UPDATE payment_tx SET state=2, perform_time=? WHERE id=?').run(pt, t.id);
      onPaid(t.order_id, 'payme', Math.round(t.amount / 100));
      return txOut({ ...t, state: 2, perform_time: pt });
    },
    CancelTransaction(p) {
      let t = getTx(p.id) || pErr(-31003, msg('Tranzaksiya topilmadi', 'Транзакция не найдена'));
      if (t.state === 1) { t = cancelTx(t, -1, Number(p.reason) || null); onCancelled(t.order_id, false); }
      else if (t.state === 2) {
        const o = getOrder(t.order_id);
        // Restoran buyurtmani qabul qilgan bo'lsa (taom tayyorlanmoqda) — qaytarib bo'lmaydi
        if (o && !['new', 'awaiting_payment', 'cancelled', 'rejected'].includes(o.status)) pErr(-31007, msg("Buyurtma bajarilmoqda, bekor qilib bo'lmaydi", 'Заказ выполняется, отмена невозможна'));
        t = cancelTx(t, -2, Number(p.reason) || null); onCancelled(t.order_id, true);
      }
      return { transaction: String(t.id), cancel_time: t.cancel_time, state: t.state };
    },
    CheckTransaction(p) {
      const t = getTx(p.id) || pErr(-31003, msg('Tranzaksiya topilmadi', 'Транзакция не найдена'));
      return { ...txOut(t), reason: t.reason ?? null };
    },
    GetStatement(p) {
      const rows = db.prepare("SELECT * FROM payment_tx WHERE provider='payme' AND create_time BETWEEN ? AND ? ORDER BY create_time").all(Number(p.from) || 0, Number(p.to) || 0);
      return { transactions: rows.map((t) => ({ id: t.ext_id, time: t.ext_time, amount: t.amount, account: { order_id: String(t.order_id) }, ...txOut(t), reason: t.reason ?? null })) };
    },
  };
  route('POST', '/api/pay/payme', null, ({ req, body }) => {
    const id = body?.id ?? null;
    if (!enabled.payme) return { id, error: { code: -32504, message: msg("Payme ulanmagan", 'Payme не подключен') } };
    if (!paymeAuth(req)) return { id, error: { code: -32504, message: msg('Ruxsat yo\'q', 'Недостаточно привилегий') } };
    const fn = PAYME[body?.method];
    if (!fn) return { id, error: { code: -32601, message: msg('Usul topilmadi', 'Метод не найден'), data: body?.method } };
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(body.params || {}); db.exec('COMMIT'); return { id, result }; }
    catch (e) {
      db.exec('ROLLBACK');
      if (e instanceof PaymeError) return { id, error: { code: e.code, message: e.m, data: e.data } };
      console.error('Payme xatosi:', e);
      return { id, error: { code: -32400, message: msg('Tizim xatosi', 'Системная ошибка') } };
    }
  });

  // ---------- Click ----------
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  function clickHandler(body, action) {
    const b = body || {};
    const out = (error, error_note, extra = {}) => ({ click_trans_id: b.click_trans_id, merchant_trans_id: b.merchant_trans_id, error, error_note, ...extra });
    if (!enabled.click) return out(-8, 'Click ulanmagan');
    const signBase = action === 0
      ? `${b.click_trans_id}${b.service_id}${env.CLICK_SECRET_KEY}${b.merchant_trans_id}${b.amount}${b.action}${b.sign_time}`
      : `${b.click_trans_id}${b.service_id}${env.CLICK_SECRET_KEY}${b.merchant_trans_id}${b.merchant_prepare_id}${b.amount}${b.action}${b.sign_time}`;
    const sign = String(b.sign_string || '');
    if (sign.length !== 32 || !crypto.timingSafeEqual(Buffer.from(md5(signBase)), Buffer.from(sign))) return out(-1, 'SIGN CHECK FAILED');
    if (String(b.action) !== String(action)) return out(-3, 'Action not found');
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = (() => {
        const o = getOrder(Number(b.merchant_trans_id));
        if (!o) return out(-5, 'Order not found');
        if (Math.abs(Number(b.amount) - o.prepay_amount) > 0.009) return out(-2, 'Incorrect amount');
        const t = db.prepare("SELECT * FROM payment_tx WHERE provider='click' AND ext_id=?").get(String(b.click_trans_id));
        if (action === 0) {
          if (o.payment_status === 'paid') return out(-4, 'Already paid');
          if (o.status !== 'awaiting_payment') return out(-9, 'Transaction cancelled');
          const id = t ? t.id : db.prepare("INSERT INTO payment_tx (provider,ext_id,order_id,amount,state,create_time) VALUES ('click',?,?,?,1,?)").run(String(b.click_trans_id), o.id, o.prepay_amount, Date.now()).lastInsertRowid;
          return out(0, 'Success', { merchant_prepare_id: id });
        }
        if (!t || String(t.id) !== String(b.merchant_prepare_id)) return out(-6, 'Transaction does not exist');
        if (t.state === 2) return out(-4, 'Already paid', { merchant_confirm_id: t.id });
        if (t.state < 0) return out(-9, 'Transaction cancelled');
        if (Number(b.error) < 0) { db.prepare('UPDATE payment_tx SET state=-1, cancel_time=? WHERE id=?').run(Date.now(), t.id); onCancelled(o.id, false); return out(-9, 'Transaction cancelled'); }
        if (o.status !== 'awaiting_payment') return out(-9, 'Transaction cancelled');
        db.prepare('UPDATE payment_tx SET state=2, perform_time=? WHERE id=?').run(Date.now(), t.id);
        onPaid(o.id, 'click', o.prepay_amount);
        return out(0, 'Success', { merchant_confirm_id: t.id });
      })();
      db.exec('COMMIT');
      return r;
    } catch (e) { db.exec('ROLLBACK'); console.error('Click xatosi:', e); return out(-7, 'Failed to update'); }
  }
  route('POST', '/api/pay/click/prepare', null, ({ body }) => clickHandler(body, 0));
  route('POST', '/api/pay/click/complete', null, ({ body }) => clickHandler(body, 1));

  return { providers, checkoutUrl, enabled };
};
