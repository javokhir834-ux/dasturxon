// Dasturxon — mijoz ilovasi toifa ikonkalari (o'zimiz chizgan SVG, 64x64). Tashqi fayl yuklanmaydi.
'use strict';

const ICONS = {
  all: `<rect x="8" y="8" width="21" height="21" rx="6" fill="#ff5a36"/><rect x="35" y="8" width="21" height="21" rx="6" fill="#ffb020"/>
    <rect x="8" y="35" width="21" height="21" rx="6" fill="#1fa971"/><rect x="35" y="35" width="21" height="21" rx="10.5" fill="#3d8bfd"/>`,
  restoran: `<rect x="6" y="46" width="52" height="6" rx="3" fill="#8a5a3c"/><path d="M10 46a22 22 0 0 1 44 0z" fill="#f2c94c"/>
    <path d="M16 44a16 16 0 0 1 10-14" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/>
    <rect x="29" y="18" width="6" height="7" rx="3" fill="#d4a017"/>`,
  milliy: `<ellipse cx="32" cy="44" rx="27" ry="10" fill="#2f6fd1"/><ellipse cx="32" cy="42" rx="22" ry="7" fill="#fff"/>
    <path d="M14 42q4-18 18-20q14 2 18 20z" fill="#f5d27a"/><path d="M19 38l6-3M27 34l5 2M35 33l6 3M24 40l5-2M37 39l5-2" stroke="#f07c1f" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="30" cy="27" r="4.5" fill="#8a4b2a"/><circle cx="37" cy="29" r="3.5" fill="#8a4b2a"/>
    <path d="M11 47q3 2 6 0M23 49q3 2 6 0M35 49q3 2 6 0M47 47q3 2 6 0" stroke="#fff" stroke-width="1.8" fill="none"/>`,
  fastfood: `<path d="M10 30a22 16 0 0 1 44 0z" fill="#f2a33a"/><circle cx="24" cy="21" r="1.4" fill="#fff6dc"/><circle cx="33" cy="18" r="1.4" fill="#fff6dc"/><circle cx="41" cy="23" r="1.4" fill="#fff6dc"/>
    <path d="M8 33q6-4 12 0t12 0t12 0t12 0v2H8z" fill="#5cbf4a"/><path d="M10 37h44l-6 5H16z" fill="#ffd23f"/>
    <rect x="9" y="38" width="46" height="7" rx="3.5" fill="#7a3e22"/><path d="M10 47h44a4 4 0 0 1-4 6H14a4 4 0 0 1-4-6z" fill="#f2a33a"/>`,
  pizza: `<path d="M32 58L8 14q24-10 48 0z" fill="#ffd36b"/><path d="M8 14q24-10 48 0l-3 6q-21-8-42 0z" fill="#d98a3a"/>
    <circle cx="26" cy="26" r="4.5" fill="#e0453a"/><circle cx="38" cy="30" r="4.5" fill="#e0453a"/><circle cx="31" cy="42" r="4" fill="#e0453a"/>
    <path d="M22 35l3 2M40 21l3-1M35 48l2 2" stroke="#3a9d3a" stroke-width="2.6" stroke-linecap="round"/>`,
  sushi: `<ellipse cx="25" cy="44" rx="17" ry="7" fill="#1f2a2a"/><rect x="8" y="30" width="34" height="14" fill="#1f2a2a"/>
    <ellipse cx="25" cy="30" rx="17" ry="7" fill="#2c3b3a"/><ellipse cx="25" cy="30" rx="13" ry="5" fill="#fff"/><ellipse cx="25" cy="30" rx="6" ry="2.6" fill="#ff7a45"/>
    <circle cx="22" cy="29" r="1.2" fill="#5cbf4a"/><path d="M40 10L58 40M46 8L60 36" stroke="#c98a2b" stroke-width="3.2" stroke-linecap="round"/>`,
  kafe: `<path d="M24 8q-4 5 0 10t0 10M33 8q-4 5 0 10t0 10" stroke="#b8a89a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="30" cy="54" rx="24" ry="5" fill="#d7c4b2"/><path d="M12 32h36v8a16 14 0 0 1-36 0z" fill="#fff" stroke="#a0703c" stroke-width="2.5"/>
    <path d="M48 35h3a6 6 0 0 1 0 12h-5" stroke="#a0703c" stroke-width="3" fill="none"/><ellipse cx="30" cy="32" rx="18" ry="3.5" fill="#6b3f1d"/>`,
  choyxona: `<path d="M44 30l12-6-2 6-8 8z" fill="#2f6fd1"/><path d="M12 28h34v14a17 13 0 0 1-34 0z" fill="#2f6fd1"/>
    <path d="M10 28h38" stroke="#1f4f9e" stroke-width="3" stroke-linecap="round"/><rect x="25" y="20" width="8" height="6" rx="3" fill="#1f4f9e"/>
    <path d="M10 33q-6 4 0 11" stroke="#1f4f9e" stroke-width="3" fill="none"/>
    <path d="M18 36q3 3 6 0t6 0t6 0t6 0" stroke="#fff" stroke-width="2" fill="none"/><circle cx="29" cy="44" r="2.2" fill="#fff"/><circle cx="22" cy="43" r="1.4" fill="#fff"/><circle cx="36" cy="43" r="1.4" fill="#fff"/>
    <path d="M46 48h14l-2 7h-10z" fill="#fff" stroke="#2f6fd1" stroke-width="2"/>`,
  shirinlik: `<path d="M8 50l46-14v14z" fill="#f7d9a8"/><path d="M8 50V40l46-14v10z" fill="#fff4f8"/><path d="M8 40l46-14" stroke="#e65aa8" stroke-width="4"/>
    <path d="M8 44l46-13" stroke="#f0a8cf" stroke-width="3"/><rect x="8" y="50" width="46" height="5" rx="2" fill="#c98a5a"/>
    <circle cx="44" cy="22" r="5" fill="#e0233a"/><path d="M44 17q2-7 8-8" stroke="#3a9d3a" stroke-width="2.2" fill="none"/>`,
  nonvoyxona: `<circle cx="32" cy="34" r="25" fill="#d9903a"/><circle cx="32" cy="34" r="25" fill="none" stroke="#b86e22" stroke-width="3"/>
    <circle cx="32" cy="34" r="13" fill="#f2c27a"/><g fill="#9a5a1c"><circle cx="32" cy="34" r="1.6"/><circle cx="27" cy="30" r="1.4"/><circle cx="37" cy="30" r="1.4"/>
    <circle cx="27" cy="38" r="1.4"/><circle cx="37" cy="38" r="1.4"/><circle cx="32" cy="27" r="1.4"/><circle cx="32" cy="41" r="1.4"/><circle cx="25" cy="34" r="1.4"/><circle cx="39" cy="34" r="1.4"/></g>
    <path d="M16 22q4-5 9-7" stroke="#f2c27a" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  dokon: `<path d="M24 24v-6a8 8 0 0 1 16 0v6" stroke="#4b3fd1" stroke-width="3.2" fill="none"/>
    <circle cx="22" cy="20" r="7" fill="#e0453a"/><path d="M22 13q1-4 4-5" stroke="#3a9d3a" stroke-width="2.2"/><path d="M38 6l6 16-6 2z" fill="#f07c1f"/><path d="M38 6l-3-4M38 6l2-5" stroke="#3a9d3a" stroke-width="2"/>
    <path d="M12 24h40l-4 32H16z" fill="#6a5cff"/><path d="M12 24h40l-1 6H13z" fill="#4b3fd1"/><rect x="24" y="38" width="16" height="6" rx="3" fill="#fff" opacity=".85"/>`,
  dorixona: `<g transform="rotate(-40 32 32)"><rect x="8" y="22" width="48" height="20" rx="10" fill="#fff" stroke="#2bb3c0" stroke-width="3"/>
    <path d="M32 23.5h14a8.5 8.5 0 0 1 0 17H32z" fill="#2bb3c0"/></g><path d="M12 50h8M16 46v8" stroke="#2bb3c0" stroke-width="3" stroke-linecap="round"/>`,
  gullar: `<path d="M32 34v24M32 46q-8-2-12-10M32 50q8-2 12-9" stroke="#3a9d3a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g fill="#ff6fa8"><circle cx="32" cy="14" r="7"/><circle cx="22" cy="22" r="7"/><circle cx="42" cy="22" r="7"/><circle cx="26" cy="33" r="7"/><circle cx="38" cy="33" r="7"/></g>
    <circle cx="32" cy="25" r="6" fill="#ffd23f"/><path d="M22 52h20l-3 8H25z" fill="#d94f8a"/>`,
};
// SVG belgisini qaytaradi; noma'lum kalit uchun restoran ikonkasi.
const icon = (key, size = 36) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${ICONS[key] || ICONS.restoran}</svg>`;
