// Ma'lumotlar bazasi: node:sqlite (Node 22+), tashqi paketsiz.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'db.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SALT = 'dasturxon-pin-v1';
const hashPin = (pin) => crypto.createHash('sha256').update(SALT + String(pin)).digest('hex');

db.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, service_percent INTEGER DEFAULT 0,
  receipt_printer TEXT DEFAULT '', receipt_footer TEXT DEFAULT 'Xaridingiz uchun rahmat!',
  fiscal_mode TEXT DEFAULT 'off', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL,
  pin_hash TEXT NOT NULL, role TEXT NOT NULL,
  active INTEGER DEFAULT 1, pay_type TEXT DEFAULT 'none', rate INTEGER DEFAULT 0, percent INTEGER DEFAULT 0, percent_base TEXT DEFAULT 'sales',
  UNIQUE(business_id, pin_hash)
);
CREATE TABLE IF NOT EXISTS halls (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS tables (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, hall_id INTEGER NOT NULL, name TEXT NOT NULL, seats INTEGER DEFAULT 4, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS workshops (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, printer TEXT DEFAULT '', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, color TEXT DEFAULT '#2f855a', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, category_id INTEGER NOT NULL, workshop_id INTEGER NOT NULL,
  name TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, mxik TEXT DEFAULT '', unit TEXT DEFAULT 'dona',
  in_stop INTEGER DEFAULT 0, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS modifiers (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, status TEXT DEFAULT 'open',
  opened_by INTEGER, opened_at TEXT, opening_cash INTEGER DEFAULT 0,
  closed_by INTEGER, closed_at TEXT, counted_cash INTEGER, expected_cash INTEGER
);
CREATE TABLE IF NOT EXISTS cash_moves (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, shift_id INTEGER NOT NULL, type TEXT CHECK(type IN ('in','out')), amount INTEGER NOT NULL, note TEXT, user_id INTEGER, at TEXT);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, shift_id INTEGER NOT NULL, number INTEGER NOT NULL,
  table_id INTEGER, waiter_id INTEGER, guests INTEGER DEFAULT 1, status TEXT DEFAULT 'open',
  discount_percent INTEGER DEFAULT 0, discount_amount INTEGER DEFAULT 0, discount_reason TEXT,
  service_percent INTEGER DEFAULT 0, precheck_at TEXT, comment TEXT,
  created_at TEXT, closed_at TEXT, closed_by INTEGER, cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, order_id INTEGER NOT NULL, product_id INTEGER, workshop_id INTEGER,
  name TEXT NOT NULL, price INTEGER NOT NULL, mod_price INTEGER DEFAULT 0, modifiers TEXT DEFAULT '[]',
  qty INTEGER NOT NULL DEFAULT 1, comment TEXT DEFAULT '', status TEXT DEFAULT 'new',
  created_by INTEGER, created_at TEXT, sent_at TEXT, ready_at TEXT, cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, order_id INTEGER NOT NULL, shift_id INTEGER NOT NULL,
  method TEXT NOT NULL, amount INTEGER NOT NULL,
  user_id INTEGER, at TEXT, fiscal_status TEXT, fiscal_ref TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER, details TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(business_id, status);
`);

// Namuna ma'lumotlar (faqat bo'sh bazada)
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM businesses').get().c > 0) return;
  const B = 1;
  db.prepare('INSERT INTO businesses (id,name,service_percent) VALUES (?,?,?)').run(B, 'Namuna restoran', 10);
  const u = db.prepare('INSERT INTO users (business_id,name,pin_hash,role) VALUES (?,?,?,?)');
  u.run(B, 'Admin', hashPin('1111'), 'admin');
  u.run(B, 'Kassir', hashPin('2222'), 'kassir');
  u.run(B, 'Ofitsiant Ali', hashPin('3333'), 'ofitsiant');
  u.run(B, 'Oshpaz', hashPin('4444'), 'oshpaz');
  const h = db.prepare('INSERT INTO halls (business_id,name,sort) VALUES (?,?,?)');
  const hall1 = h.run(B, 'Asosiy zal', 1).lastInsertRowid;
  const hall2 = h.run(B, 'Ayvon', 2).lastInsertRowid;
  const t = db.prepare('INSERT INTO tables (business_id,hall_id,name,seats,sort) VALUES (?,?,?,?,?)');
  for (let i = 1; i <= 8; i++) t.run(B, hall1, 'Stol ' + i, i % 3 === 0 ? 6 : 4, i);
  for (let i = 1; i <= 4; i++) t.run(B, hall2, 'Ayvon ' + i, 8, i);
  const w = db.prepare('INSERT INTO workshops (business_id,name) VALUES (?,?)');
  const kitchen = w.run(B, 'Oshxona').lastInsertRowid;
  const bar = w.run(B, 'Bar').lastInsertRowid;
  const tandir = w.run(B, 'Tandir').lastInsertRowid;
  const c = db.prepare('INSERT INTO categories (business_id,name,color,sort) VALUES (?,?,?,?)');
  const hot = c.run(B, 'Issiq taomlar', '#c05621', 1).lastInsertRowid;
  const grill = c.run(B, 'Shashlik', '#9b2c2c', 2).lastInsertRowid;
  const salad = c.run(B, 'Salatlar', '#2f855a', 3).lastInsertRowid;
  const bread = c.run(B, 'Non va somsa', '#b7791f', 4).lastInsertRowid;
  const drinks = c.run(B, 'Ichimliklar', '#2b6cb0', 5).lastInsertRowid;
  const p = db.prepare('INSERT INTO products (business_id,category_id,workshop_id,name,price,sort) VALUES (?,?,?,?,?,?)');
  [['Osh (1 porsiya)', 35000], ["Lag'mon", 32000], ['Manti (5 dona)', 30000], ['Qozon kabob', 60000], ["Sho'rva", 28000]]
    .forEach(([n, pr], i) => p.run(B, hot, kitchen, n, pr, i));
  [["Mol go'shti shashlik", 18000], ["Qo'y go'shti shashlik", 20000], ['Jigar shashlik', 15000], ['Tovuq shashlik', 14000]]
    .forEach(([n, pr], i) => p.run(B, grill, kitchen, n, pr, i));
  [['Achchiq-chuchuk', 15000], ['Toshkent salati', 25000], ["Sezar salati", 30000]]
    .forEach(([n, pr], i) => p.run(B, salad, kitchen, n, pr, i));
  [['Tandir non', 4000], ['Somsa', 8000], ['Patir', 7000]]
    .forEach(([n, pr], i) => p.run(B, bread, tandir, n, pr, i));
  [["Ko'k choy (choynak)", 5000], ['Qora choy (choynak)', 5000], ['Kola 0.5', 9000], ['Mineral suv', 6000], ['Kompot (1 l)', 15000]]
    .forEach(([n, pr], i) => p.run(B, drinks, bar, n, pr, i));
  const m = db.prepare('INSERT INTO modifiers (business_id,name,price) VALUES (?,?,?)');
  m.run(B, 'Piyozsiz', 0); m.run(B, 'Achchiq', 0); m.run(B, 'Kamroq tuz', 0);
  m.run(B, "Qo'shimcha go'sht", 12000); m.run(B, 'Katta porsiya', 15000);
}
seed();

module.exports = { db, hashPin, DATA_DIR };
