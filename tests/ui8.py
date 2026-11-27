# Mobil ilovalar (Capacitor) sinovi brauzerda: www papkalari alohida "origin" dan beriladi, window.Capacitor soxtalashtiriladi.
# Oldin: cd mobile && npm install && node build.mjs
# Server: APP_ORIGINS=http://127.0.0.1:8095,http://127.0.0.1:8096,http://127.0.0.1:8097 PLATFORM_PASSWORD=pp-123456 DISPATCH_MS=500 node src/server.ts
import asyncio, json, os, subprocess, urllib.request
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = "http://127.0.0.1:8080"; OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots8"); os.makedirs(OUT, exist_ok=True); errors = []
APPS = {"mijoz": 8095, "kuryer": 8096, "biznes": 8097}
FAKE = "window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {}, registerPlugin: () => null };"
REST = (40.1033, 65.3735)
def call(method, path, body=None, tok=None):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = "Bearer " + tok
    r = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    return json.loads(urllib.request.urlopen(r).read())
def watch(pg, name):
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{name}: {m.text}"))
    pg.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
    pg.on("response", lambda r: r.status == 404 and errors.append(f"{name}: 404 {r.url}"))
async def connect(pg, port):
    await pg.goto(f"http://127.0.0.1:{port}/"); await pg.wait_for_selector("#srv")
    await pg.fill("#srv", "127.0.0.1:8080"); await pg.click("#go")
async def main():
    srv = [subprocess.Popen(["python3", "-m", "http.server", str(p), "-b", "127.0.0.1", "-d", os.path.join(ROOT, "mobile", "apps", a, "www")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for a, p in APPS.items()]
    await asyncio.sleep(1)
    try:
        plat = call("POST", "/api/platform/login", {"password": "pp-123456"})["token"]
        call("POST", "/api/platform/settings", {"offer_seconds": 60}, plat)
        call("POST", "/api/platform/businesses/1/subscription", {"product": "delivery", "enabled": True, "paid_until": "2027-12-31"}, plat)
        adm = call("POST", "/api/login", {"pin": "1111"})["token"]; call("POST", "/api/shift/open", {"opening_cash": 0}, adm)
        call("POST", "/api/delivery/settings", {"enabled": True, "address": "Navoiy markaz", "delivery_fee": 9000, "lat": REST[0], "lng": REST[1]}, adm)
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
            # ---- Biznes ilovasi (planshet)
            bc = await b.new_context(viewport={"width": 1280, "height": 800}); await bc.add_init_script(FAKE)
            pos = await bc.new_page(); watch(pos, "biznes")
            await pos.goto("http://127.0.0.1:8097/"); await pos.wait_for_selector("#srv"); await pos.screenshot(path=f"{OUT}/01-biznes-launcher.png")
            await pos.fill("#srv", "127.0.0.1:8080"); await pos.click("#go")
            await pos.wait_for_selector(".pad")
            for d in "2222": await pos.click(f'.pad button[data-k="{d}"]')
            await pos.wait_for_selector("header.top"); await pos.click('nav.tabs button[data-v="delivery"]'); await pos.wait_for_timeout(800)
            await pos.screenshot(path=f"{OUT}/02-biznes-pos.png")
            # ---- Mijoz ilovasi
            mc = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True); await mc.add_init_script(FAKE)
            m = await mc.new_page(); watch(m, "mijoz"); m.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
            await connect(m, 8095); await m.wait_for_selector(".prow"); await m.screenshot(path=f"{OUT}/10-mijoz-places.png")
            assert await m.is_visible(".dx-srv"), "server tugmasi ko'rinmadi"
            await m.click(".prow"); await m.wait_for_selector(".mi")
            await m.click('.mi >> nth=0 >> [data-a="qty"]'); await m.click('.mi >> nth=0 >> [data-d="1"]')
            await m.click(".bottombar .btn"); await m.wait_for_selector("#qbox .label"); await m.fill("#addr", "Navoiy, Galaba 5-uy")
            await m.click("#place"); await m.wait_for_selector("#ph"); await m.fill("#ph", "977009988"); await m.click('[data-a="otp"]')
            await m.wait_for_selector('#dev:has-text("kod")'); await m.fill("#code", (await m.text_content("#dev")).split("—")[-1].strip()); await m.fill("#nm", "Aziz")
            await m.click('[data-a="login"]'); await m.wait_for_selector("#qbox .label"); await m.click("#place")
            await m.wait_for_selector('[data-a="testpay"]'); await m.click('[data-a="testpay"]'); await m.wait_for_selector(".prog")
            await m.screenshot(path=f"{OUT}/11-mijoz-order.png")
            # ---- Biznes: SSE orqali yangi buyurtma keldi → qabul
            await pos.wait_for_selector(".dcard.new", timeout=8000); await pos.screenshot(path=f"{OUT}/03-biznes-new-order.png")
            await pos.click('.dcard.new [data-a="dAccept"]'); await pos.click('.modal [data-v="20"]'); await pos.wait_for_selector(".dcard.accepted")
            # ---- Kuryer ilovasi (ro'yxat API orqali, ish — ilovada)
            o = call("POST", "/api/k/otp", {"phone": "935557777"}); kt = call("POST", "/api/k/login", {"phone": "935557777", "code": o["dev_code"]})["token"]
            img = "data:image/jpeg;base64," + "A" * 400
            call("POST", "/api/k/profile", {"name": "Sardor", "vehicle": "velosiped"}, kt)
            for k in ("passport", "selfie"): call("POST", "/api/k/docs", {"kind": k, "data": img}, kt)
            call("POST", "/api/k/test", {"answers": [1, 1, 1, 0, 1, 1, 1, 0]}, kt); call("POST", "/api/k/submit", None, kt)
            cid = call("GET", "/api/platform/couriers", None, plat)[0]["id"]; call("POST", f"/api/platform/couriers/{cid}/status", {"action": "approve"}, plat)
            kc = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True); await kc.add_init_script(FAKE)
            await kc.grant_permissions(["geolocation"], origin="http://127.0.0.1:8096"); await kc.set_geolocation({"latitude": REST[0] + 0.003, "longitude": REST[1]})
            k = await kc.new_page(); watch(k, "kuryer")
            await connect(k, 8096); await k.wait_for_selector("#ph"); await k.fill("#ph", "935557777"); await k.click('[data-a="otp"]')
            await k.wait_for_selector('#dev:has-text("kod")'); await k.fill("#code", (await k.text_content("#dev")).split("—")[-1].strip()); await k.click('[data-a="login"]')
            await k.wait_for_selector('[data-a="online"]'); await k.click('[data-a="online"]'); await k.wait_for_selector('[data-a="online"].on')
            await k.wait_for_selector(".offer", timeout=25000); await k.screenshot(path=f"{OUT}/20-kuryer-offer.png")
            await k.click('[data-a="accept"]'); await k.wait_for_selector('[data-v="arrived_rest"]'); await k.screenshot(path=f"{OUT}/21-kuryer-order.png")
            await pos.wait_for_selector(".cline", timeout=8000); await pos.screenshot(path=f"{OUT}/04-biznes-courier.png")
            await b.close()
    finally:
        for s in srv: s.kill()
    print("ERRORS:", errors or "yo'q")
asyncio.run(main())
