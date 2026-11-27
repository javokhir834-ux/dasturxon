// FastHub — ochilish animatsiyasi (splash): ko'k fon, oq kartada chaqmoq, tezlik chiziqlari, nom va shior.
// Barcha ilovalarda: <script src="/splash.js" data-name="FastHub Kuryer"></script> — <body> boshida. Bir sessiyada bir marta ko'rinadi.
'use strict';
(() => {
  try { if (sessionStorage.getItem('fh_splash')) return; sessionStorage.setItem('fh_splash', '1'); } catch { /* xususiy rejim */ }
  const name = document.currentScript?.dataset.name || 'FastHub Uz';
  const fast = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD = fast ? 600 : 1900; // ekranda turish vaqti, ms
  const css = `
#fh-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
  background:radial-gradient(120% 80% at 50% 35%,#3B82FF 0%,#1D6BFF 45%,#0B4FD8 100%);color:#fff;font-family:-apple-system,"SF Pro Text",Inter,system-ui,"Segoe UI",Roboto,sans-serif;
  transition:opacity .45s ease,transform .55s cubic-bezier(.32,.72,0,1)}
#fh-splash.out{opacity:0;transform:scale(1.06)}
#fh-splash .mark{position:relative;display:flex;align-items:center}
#fh-splash .lines{position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-end;gap:9px}
#fh-splash .lines i{display:block;height:7px;border-radius:4px;background:rgba(255,255,255,.9);transform-origin:right;animation:fhLine .7s cubic-bezier(.32,.72,0,1) both}
#fh-splash .lines i:nth-child(1){width:34px;animation-delay:.35s}#fh-splash .lines i:nth-child(2){width:24px;animation-delay:.42s}#fh-splash .lines i:nth-child(3){width:14px;animation-delay:.49s}
#fh-splash .card{width:96px;height:96px;border-radius:28px;background:#fff;display:flex;align-items:center;justify-content:center;
  box-shadow:0 18px 40px rgba(6,30,90,.35);animation:fhPop .75s cubic-bezier(.34,1.56,.64,1) both}
#fh-splash .card svg{width:54px;height:54px;animation:fhBolt .6s .45s cubic-bezier(.34,1.56,.64,1) both}
#fh-splash .t{text-align:center;animation:fhUp .6s .65s cubic-bezier(.32,.72,0,1) both}
#fh-splash .t b{display:block;font-size:30px;font-weight:800;letter-spacing:-.6px}
#fh-splash .t span{display:block;margin-top:6px;font-size:15px;font-weight:600;opacity:.85}
#fh-splash .ring{position:absolute;width:96px;height:96px;border-radius:28px;border:2px solid rgba(255,255,255,.6);animation:fhRing 1.6s .3s ease-out both}
@keyframes fhPop{0%{transform:translateX(-60px) scale(.4) rotate(-12deg);opacity:0}100%{transform:none;opacity:1}}
@keyframes fhBolt{0%{transform:scale(.2) rotate(-30deg);opacity:0}100%{transform:none;opacity:1}}
@keyframes fhLine{0%{transform:scaleX(0);opacity:0}60%{opacity:1}100%{transform:scaleX(1)}}
@keyframes fhUp{0%{transform:translateY(14px);opacity:0}100%{transform:none;opacity:1}}
@keyframes fhRing{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.2);opacity:0}}
@media (prefers-reduced-motion: reduce){#fh-splash *{animation-duration:.01s!important;animation-delay:0s!important}}`;
  const style = document.createElement('style'); style.textContent = css;
  const el = document.createElement('div'); el.id = 'fh-splash'; el.setAttribute('role', 'presentation');
  el.innerHTML = `<div class="mark"><div class="lines"><i></i><i></i><i></i></div><span class="ring"></span><div class="card">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill="#1D6BFF" stroke="#1D6BFF" stroke-width="1.4" stroke-linejoin="round"/></svg></div></div>
    <div class="t"><b>${name.replace(/[<>&]/g, '')}</b><span>Tez. Qulay. Hammasi bir joyda.</span></div>`;
  document.documentElement.append(style, el);
  const close = () => { el.classList.add('out'); setTimeout(() => { el.remove(); style.remove(); }, 600); };
  setTimeout(close, HOLD);
  el.addEventListener('click', close, { once: true }); // shoshilgan foydalanuvchi bosib o'tkazib yuborishi mumkin
})();
