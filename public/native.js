// Mobil ilova (Capacitor) ko'prigi. Brauzerda hech narsa qilmaydi.
// Ilovada: /api va /img so'rovlarini tanlangan serverga yo'naltiradi, push tokenni ro'yxatdan o'tkazadi, fonda GPS beradi.
(function () {
  'use strict';
  var C = window.Capacitor;
  var native = !!(C && C.isNativePlatform && C.isNativePlatform());
  var cfg = window.DX_CONFIG || {};
  var base = '';
  try { base = (localStorage.getItem('dx_server') || cfg.server || '').replace(/\/+$/, ''); } catch (e) { /* */ }
  var remote = function (u) { return typeof u === 'string' && /^\/(api|img|legal)\//.test(u); };
  var DX = window.DX = {
    native: native,
    base: base,
    app: cfg.app || '',
    /** Server rasmi/yo'li: ilovada to'liq manzil, brauzerda o'zgarmaydi */
    asset: function (u) { return native && base && remote(u) ? base + u : u; },
    /** Server manzilini o'zgartirish (ilovada) */
    changeServer: function () { try { localStorage.removeItem('dx_server'); } catch (e) { /* */ } location.replace('/index.html?setup=1'); },
    plugin: function (name) { return native ? (C.Plugins && C.Plugins[name]) || (C.registerPlugin && C.registerPlugin(name)) : null; },
  };
  if (!native) return;
  if (!base && !/[?&]setup=1/.test(location.search) && location.pathname !== '/index.html' && location.pathname !== '/') { location.replace('/index.html?setup=1'); return; }

  // ---- So'rovlarni serverga yo'naltirish
  var ofetch = window.fetch.bind(window);
  window.fetch = function (u, o) { return ofetch(remote(u) ? base + u : u, o); };
  if (window.EventSource) {
    var OES = window.EventSource;
    window.EventSource = function (u, c) { return new OES(remote(u) ? base + u : u, c); };
    window.EventSource.prototype = OES.prototype;
  }

  // ---- Fonda GPS (kuryer): ekran o'chiq bo'lsa ham joylashuv yuboriladi
  var BG = cfg.backgroundGps ? DX.plugin('BackgroundGeolocation') : null;
  DX.watchPosition = function (ok, fail) {
    if (!BG) return { web: navigator.geolocation.watchPosition(ok, fail, { enableHighAccuracy: true, maximumAge: 5000 }) };
    var h = { bg: null };
    BG.addWatcher({ backgroundMessage: "Buyurtmalar kelishi uchun joylashuvingiz yuborilmoqda", backgroundTitle: (cfg.name || '') + ' — liniyadasiz',
      requestPermissions: true, stale: false, distanceFilter: 20 }, function (loc, err) {
      if (err) return fail && fail(err);
      if (loc) ok({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy } });
    }).then(function (id) { h.bg = id; });
    return h;
  };
  DX.clearWatch = function (h) {
    if (!h) return;
    if (h.web != null) navigator.geolocation.clearWatch(h.web);
    if (h.bg && BG) BG.removeWatcher({ id: h.bg });
  };

  // ---- Kirish ekranida "⚙ Server" tugmasi (kirilmagan holatda ko'rinadi)
  var AUTH = { mijoz: 'dx_ctoken', kuryer: 'dx_ktoken', biznes: 'token' }[DX.app];
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('button');
    b.textContent = '⚙ Server'; b.className = 'dx-srv';
    b.style.cssText = 'position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:99;padding:6px 10px;border-radius:10px;font-size:12px;background:rgba(0,0,0,.35);color:#9ab;border:1px solid #2e3d36';
    b.onclick = function () { if (confirm('Server: ' + base + '\nBoshqa serverga ulanasizmi?')) DX.changeServer(); };
    document.body.appendChild(b);
    var tick = function () { var t = null; try { t = localStorage.getItem(AUTH); } catch (e) { /* */ } b.style.display = t ? 'none' : ''; };
    tick(); setInterval(tick, 1500);
  });

  // ---- Push xabarlar (Firebase sozlangan bo'lsa: cfg.push = true)
  var KEYS = { mijoz: ['dx_ctoken', '/api/c/push-token'], kuryer: ['dx_ktoken', '/api/k/push-token'], biznes: ['token', '/api/push-token'] };
  var P = cfg.push ? DX.plugin('PushNotifications') : null;
  if (P && KEYS[DX.app]) {
    var devToken = null, sentFor = null;
    var sendToken = function () {
      var auth = null; try { auth = localStorage.getItem(KEYS[DX.app][0]); } catch (e) { /* */ }
      if (!devToken || !auth || sentFor === auth + devToken) return;
      ofetch(base + KEYS[DX.app][1], { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth },
        body: JSON.stringify({ token: devToken, platform: C.getPlatform() }) }).then(function (r) { if (r.ok) sentFor = auth + devToken; }).catch(function () { /* */ });
    };
    P.addListener('registration', function (t) { devToken = t.value; sendToken(); });
    P.addListener('pushNotificationActionPerformed', function (a) {
      var d = (a.notification && a.notification.data) || {};
      if (DX.app === 'mijoz' && d.id) location.hash = '#order/' + d.id;
    });
    if (P.createChannel) P.createChannel({ id: 'orders', name: 'Buyurtmalar', importance: 5, sound: 'default', vibration: true }).catch(function () { /* */ });
    P.requestPermissions().then(function (r) { if (r.receive === 'granted') P.register(); }).catch(function () { /* */ });
    setInterval(sendToken, 10000); // kirgandan keyin tokenni yuborish
  }
})();
