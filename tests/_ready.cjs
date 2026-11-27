// Testlar uchun: server ishga tushguncha kutish (/api/health javob berguncha). Qat'iy kutish sekin kompyuterda/CI da testni yiqitardi.
module.exports = async function ready(port = 8080, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* hali ishga tushmagan */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server ${port}-portda ${ms} ms ichida ishga tushmadi`);
};
