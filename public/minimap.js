// FastHub — yengil xarita (kutubxonasiz): OpenStreetMap plitkalari, belgilar (restoran, uy, kuryer, siz), punktir yo'l chizig'i.
// MiniMap.render(el, { points: [{ lat, lng, kind, id?, label? }], dark, line: [[lat,lng],...] }) — qayta chaqirilsa, plitkalar o'zgarmay
// faqat belgilar silliq suriladi (kuryer harakati). Ikonkalar: /lucide.js (ic). Plitka manzili: DX_CONFIG.tiles yoki OpenStreetMap.
// Qorong'i rejim (kuryer) — o'sha plitkalar CSS filtr bilan qorong'ilashtiriladi.
'use strict';
const MiniMap = (() => {
  const T = 256, MAXZ = 17, MINZ = 3;
  const lx = (lng, z) => ((lng + 180) / 360) * 2 ** z * T;
  const ly = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * T; };
  const tileUrl = (z, x, y, dark) => {
    const custom = window.DX_CONFIG?.tiles; // o'z tile serverimiz bo'lsa: "https://tiles.domen.uz/{z}/{x}/{y}.png"
    if (custom) return custom.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`; // OSM: kam yuklama uchun bepul; ommaviy ishga tushishda o'z tile server (DX_CONFIG.tiles)
  };
  const MK = {
    place: (p) => `<span class="mm-pin" style="background:var(--mm-acc)">${ic(p.icon || 'utensils-crossed', 15, { c: '#fff' })}</span>`,
    home: () => `<span class="mm-pin" style="background:#111114">${ic('house', 15, { c: '#fff' })}</span>`,
    courier: () => `<span class="mm-cour">${ic('bike', 18, { c: '#fff' })}</span>`,
    me: () => '<span class="mm-me"></span>',
    spot: (p) => `<span class="mm-spot" style="background:${p.color || 'var(--mm-acc)'}">${ic(p.icon || 'store', 16, { c: '#fff' })}${p.label ? `<b>${String(p.label).replace(/[<>&]/g, '')}</b>` : ''}</span>`,
  };
  const CSS = `.mm{overflow:hidden;background:#E8E4DC;--mm-acc:#1D6BFF;touch-action:pan-y}.mm.dark{background:#1B1E24}
.mm .mm-t{position:absolute;width:${T}px;height:${T}px;user-select:none;pointer-events:none;-webkit-user-drag:none}
.mm.dark .mm-t{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.6)}
.mm .mm-k{position:absolute;left:0;top:0;transform:translate(-50%,-50%);transition:left 1.2s linear,top 1.2s linear;z-index:2}
.mm .mm-k.c{z-index:3}.mm svg.mm-l{position:absolute;left:0;top:0;pointer-events:none;z-index:1}
.mm-pin{width:30px;height:30px;border-radius:15px;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
.mm-cour{width:38px;height:38px;border-radius:19px;background:var(--mm-acc);border:3px solid #fff;box-shadow:0 4px 12px rgba(29,107,255,.5);display:flex;align-items:center;justify-content:center;position:relative}
.mm-cour::before{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--mm-acc);animation:mmPulse 1.8s ease-out infinite}
.mm-me{display:block;width:18px;height:18px;border-radius:9px;background:#2F7BF6;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.mm-spot{display:flex;align-items:center;gap:6px;height:36px;padding:0 4px;border-radius:18px;border:2.5px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.22);color:#fff;font:700 13px/1 -apple-system,Inter,system-ui,sans-serif;white-space:nowrap}
.mm-spot .ic{width:26px;height:26px;border-radius:13px;background:rgba(255,255,255,.22);padding:5px;box-sizing:border-box}.mm-spot b{padding-right:8px}
.mm-attr{position:absolute;right:4px;bottom:3px;z-index:4;font:10px/1.2 system-ui,sans-serif;color:#555;background:rgba(255,255,255,.7);padding:1px 5px;border-radius:4px}
.mm.dark .mm-attr{background:rgba(0,0,0,.45);color:#bbb}
@keyframes mmPulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.9);opacity:0}}`;
  let styled = false;

  function fit(pts, w, h, pad) {
    for (let z = MAXZ; z >= MINZ; z--) {
      const xs = pts.map((p) => lx(p.lng, z)), ys = pts.map((p) => ly(p.lat, z));
      if (Math.max(...xs) - Math.min(...xs) <= w - 2 * pad && Math.max(...ys) - Math.min(...ys) <= h - 2 * pad)
        return { z, cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 };
    }
    return { z: MINZ, cx: lx(pts[0].lng, MINZ), cy: ly(pts[0].lat, MINZ) };
  }

  function render(el, { points = [], dark = false, line = null, pad = 46, zoom = null } = {}) {
    if (!el) return;
    if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); styled = true; }
    const pts = points.filter((p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng));
    const w = el.clientWidth || 360, h = el.clientHeight || 260;
    el.classList.add('mm'); el.classList.toggle('dark', !!dark);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; // fixed/absolute konteyner o'z joyida qolsin
    if (!pts.length) { el.innerHTML = ''; return; }
    let st = el._mm;
    const f = fit(pts, w, h, pad);
    if (zoom) f.z = Math.min(f.z, zoom);
    // Plitkalar faqat masshtab yoki markaz sezilarli o'zgarsa qayta chiziladi — aks holda belgi silliq suriladi
    const rebuild = !st || st.z !== f.z || st.dark !== dark || st.w !== w || Math.hypot(st.cx - f.cx, st.cy - f.cy) > Math.min(w, h) / 3;
    if (rebuild) {
      const ox = f.cx - w / 2, oy = f.cy - h / 2, n = 2 ** f.z;
      let tiles = '';
      for (let x = Math.floor(ox / T); x <= Math.floor((ox + w) / T); x++)
        for (let y = Math.max(0, Math.floor(oy / T)); y <= Math.min(n - 1, Math.floor((oy + h) / T)); y++)
          tiles += `<img class="mm-t" alt="" src="${tileUrl(f.z, ((x % n) + n) % n, y, dark)}" style="left:${x * T - ox}px;top:${y * T - oy}px">`;
      el.innerHTML = `${tiles}<svg class="mm-l" width="${w}" height="${h}"></svg><span class="mm-attr">© OpenStreetMap</span>`;
      st = el._mm = { z: f.z, cx: f.cx, cy: f.cy, w, dark, ox, oy, marks: {} };
    }
    const pos = (p) => [lx(p.lng, st.z) - st.ox, ly(p.lat, st.z) - st.oy];
    const seen = new Set();
    pts.forEach((p, i) => {
      const key = p.id || p.kind + i; seen.add(key);
      let m = st.marks[key];
      if (!m || !m.isConnected) {
        m = document.createElement(p.href ? 'a' : 'span'); m.className = 'mm-k' + (p.kind === 'courier' ? ' c' : '');
        if (p.href) { m.href = p.href; m.style.textDecoration = 'none'; }
        m.innerHTML = (MK[p.kind] || MK.place)(p); el.append(m); st.marks[key] = m;
        const [x, y] = pos(p); m.style.transition = 'none'; m.style.left = x + 'px'; m.style.top = y + 'px'; m.offsetWidth; m.style.transition = '';
      } else { const [x, y] = pos(p); m.style.left = x + 'px'; m.style.top = y + 'px'; }
    });
    for (const k of Object.keys(st.marks)) if (!seen.has(k)) { st.marks[k].remove(); delete st.marks[k]; }
    const svg = el.querySelector('svg.mm-l');
    if (svg) svg.innerHTML = line && line.length > 1 ? `<polyline points="${line.map((q) => pos({ lat: q[0], lng: q[1] }).join(',')).join(' ')}" fill="none" stroke="${dark ? '#FF7A3D' : '#1D6BFF'}"
      stroke-width="4" stroke-linecap="round" stroke-dasharray="2 9" opacity=".85"/>` : '';
  }
  /** Qayta chizishda xarita DOM elementini saqlab qolish (plitkalar qayta yuklanmasin): eski elementni yangi joyga ko'chiradi */
  function keep(oldEl, sel) { const fresh = document.querySelector(sel); if (oldEl && fresh && oldEl !== fresh) fresh.replaceWith(oldEl); return document.querySelector(sel); }
  return { render, keep };
})();
