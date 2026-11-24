// Ilova ochilganda: server manzili saqlangan bo'lsa — darhol asosiy ekranga, bo'lmasa — manzil so'raladi va /api/health bilan tekshiriladi.
(function () {
  'use strict';
  var cfg = window.DX_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var saved = null; try { saved = localStorage.getItem('dx_server'); } catch (e) { /* */ }
  var setup = /[?&]setup=1/.test(location.search);
  if (!setup && (saved || cfg.server)) { if (!saved) localStorage.setItem('dx_server', cfg.server); location.replace(cfg.entry); return; }
  var TITLE = { mijoz: ['🍽', 'Taom buyurtma qilish'], kuryer: ['🛵', 'Kuryer ilovasi'], biznes: ['🏪', 'Restoran, kafe, dorixona uchun'] }[cfg.app] || ['🍽', ''];
  $('ic').textContent = TITLE[0]; $('nm').textContent = cfg.appName || cfg.name || ''; $('sb').textContent = TITLE[1];
  $('hint').textContent = cfg.app === 'biznes'
    ? "Restoran kompyuterida server ishga tushganda oynada \"Planshet/telefon: http://192.168…\" manzili chiqadi — shuni yozing (bir xil Wi-Fi). Bulutda ishlasangiz — sayt manzili."
    : 'Platforma serveri manzili (masalan https://dasturxon.uz). Sinov uchun — kompyuteringizdagi server manzili.';
  $('srv').value = saved || cfg.server || '';
  $('w').hidden = false;
  var go = function () {
    var v = $('srv').value.trim().replace(/\/+$/, '');
    if (!v) return ($('err').textContent = 'Manzilni yozing');
    if (!/^https?:\/\//.test(v)) v = (/^(\d+\.){3}\d+(:\d+)?$/.test(v) || /:\d+$/.test(v) ? 'http://' : 'https://') + v;
    $('err').textContent = ''; $('go').disabled = true; $('go').textContent = 'Tekshirilmoqda…';
    var ctl = new AbortController(); var t = setTimeout(function () { ctl.abort(); }, 8000);
    fetch(v + '/api/health', { signal: ctl.signal }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(t);
      if (!j || j.app !== 'dasturxon') throw new Error('bad');
      localStorage.setItem('dx_server', v);
      location.replace(cfg.entry);
    }).catch(function () {
      clearTimeout(t);
      $('go').disabled = false; $('go').textContent = 'Ulanish';
      $('err').textContent = "Serverga ulanib bo'lmadi. Manzilni, internet/Wi-Fi ni va server yoqilganini tekshiring.";
    });
  };
  $('go').onclick = go;
  $('srv').onkeydown = function (e) { if (e.key === 'Enter') go(); };
})();
