# 9-etap brauzer testi: Tez sotuv (tarozi, skaner), do'kon ilovada (kg, almashtirish, olib ketish), kechki chegirma, buyurtmani o'zgartirish, platforma dorixonalar.
# Server: PLATFORM_PASSWORD=pp-123456 node src/server.ts  (toza DATA_DIR)
import asyncio, json, os, urllib.request
from playwright.async_api import async_playwright
B = "http://127.0.0.1:8080"; OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots9"); os.makedirs(OUT, exist_ok=True); errors = []
def call(method, path, body=None, tok=None):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = "Bearer " + tok
    r = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    return json.loads(urllib.request.urlopen(r).read())
def watch(pg, n): pg.on("console", lambda m: m.type == "error" and errors.append(f"{n}: {m.text}")); pg.on("pageerror", lambda e: errors.append(f"{n}: {e}"))
async def pin(page, code):
    for d in code: await page.click(f'.pad button[data-k="{d}"]')
    await page.wait_for_selector("aside.side", timeout=5000)
async def main():
    plat = call("POST", "/api/platform/login", {"password": "pp-123456"})["token"]
    call("POST", "/api/platform/businesses/1/subscription", {"product": "delivery", "enabled": True, "paid_until": "2027-12-31"}, plat)
    adm = call("POST", "/api/login", {"pin": "1111"})["token"]; call("POST", "/api/shift/open", {"opening_cash": 0}, adm)
    boot = call("GET", "/api/bootstrap", None, adm); c1 = boot["categories"][0]["id"]; w1 = boot["workshops"][0]["id"]; code = boot["business"]["code"]
    olma = call("POST", "/api/admin/products", {"name": "Olma (Qizil)", "price": 20000, "category_id": c1, "workshop_id": w1, "delivery": True, "sold_by": "kg", "step_g": 250}, adm)
    sut = call("POST", "/api/admin/products", {"name": "Sut 1L", "price": 12000, "category_id": c1, "workshop_id": w1, "delivery": True, "barcode": "4780011112222"}, adm)
    call("POST", "/api/admin/products", {"name": "Kefir 1L", "price": 11000, "category_id": c1, "workshop_id": w1, "delivery": True}, adm)
    call("POST", "/api/delivery/settings", {"enabled": True, "open": True, "place_type": "dokon", "delivery_fee": 8000, "prepay_mode": "full", "delivery_by": "own"}, adm)
    osh = [p for p in boot["products"] if p["name"].startswith("Osh")][0]
    kas = call("POST", "/api/login", {"pin": "2222"})["token"]
    call("POST", "/api/deals", {"product_id": osh["id"], "qty": 4, "percent": 50, "until": (__import__("datetime").datetime.now() + __import__("datetime").timedelta(hours=3)).strftime("%H:%M")}, kas)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
        # ---- Tez sotuv
        pos = await (await b.new_context(viewport={"width": 1440, "height": 900})).new_page(); watch(pos, "pos")
        await pos.goto(B); await pin(pos, "2222")
        await pos.click('nav.snav button[data-v="counter"]'); await pos.wait_for_selector("#cq")
        await pos.fill("#cq", "4780011112222"); await pos.press("#cq", "Enter"); await pos.wait_for_selector(".clines .line")
        await pos.fill("#cq", "Olma"); await pos.wait_for_timeout(200); await pos.click(f'.ctile[data-id="{olma["id"]}"]')
        await pos.wait_for_selector('.modal input[name="kg"]'); await pos.fill('.modal input[name="kg"]', "1.34"); await pos.click('.modal [data-m="ok"]')
        await pos.wait_for_selector(".clines .line >> nth=1")
        await pos.fill("#cgiven", "50000"); await pos.press("#cgiven", "Tab"); await pos.wait_for_selector(".note.ok")
        await pos.screenshot(path=f"{OUT}/01-tez-sotuv.png")
        assert "38 800" in await pos.text_content(".cright"), "jami 38 800 emas"
        await pos.click('[data-a="cPay"]'); await pos.wait_for_selector(".toast"); await pos.wait_for_timeout(500)
        assert await pos.query_selector(".clines .line") is None, "savat tozalanmadi"
        # ---- Mijoz: do'kon, kg, chegirma, olib ketish
        mc = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        m = await mc.new_page(); watch(m, "mijoz"); m.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await m.goto(B + "/app"); await m.wait_for_selector(".deal"); await m.screenshot(path=f"{OUT}/10-app-home-deals.png")
        await m.click(".prow"); await m.wait_for_selector(".mi")
        await m.click(f'.mi [data-a="qty"][data-id="{olma["id"]}"]'); await m.click(f'.mi [data-a="qty"][data-id="{olma["id"]}"][data-d="1"]')
        await m.click(f'.mi [data-a="qty"][data-id="{sut["id"]}"]')
        await m.click(f'.deal [data-a="qty"][data-deal]'); await m.wait_for_timeout(200)
        await m.screenshot(path=f"{OUT}/11-app-shop-menu.png", full_page=True)
        await m.click(".bottombar .btn"); await m.wait_for_selector("#qbox .label")
        await m.click('[data-a="mode"][data-v="pickup"]'); await m.wait_for_selector("#qbox .label")
        await m.click('[data-a="subst"][data-v="replace"]')
        await m.click("#place"); await m.wait_for_selector("#ph"); await m.fill("#ph", "977004411"); await m.click('[data-a="otp"]')
        await m.wait_for_selector('#dev:has-text("kod")'); await m.fill("#code", (await m.text_content("#dev")).split("—")[-1].strip()); await m.fill("#nm", "Malika")
        await m.click('[data-a="login"]'); await m.wait_for_selector("#qbox .label"); await m.wait_for_timeout(300)
        await m.screenshot(path=f"{OUT}/12-app-cart.png", full_page=True)
        await m.click("#place"); await m.wait_for_selector('[data-a="testpay"]'); await m.click('[data-a="testpay"]'); await m.wait_for_selector(".prog")
        oid = int(m.url.split("/")[-1])
        # ---- POS: o'zgartirish
        await pos.click('nav.snav button[data-v="delivery"]'); await pos.wait_for_selector(".dcard.new")
        await pos.screenshot(path=f"{OUT}/02-board-shop.png")
        await pos.click('.dcard.new [data-a="dAdjust"]'); await pos.wait_for_selector('.modal select[name="a1"]')
        await pos.fill('.modal input[name="w0"]', "400")
        await pos.select_option('.modal select[name="a1"]', label="→ Kefir 1L (11 000)")
        await pos.screenshot(path=f"{OUT}/03-adjust.png"); await pos.click('.modal [data-m="ok"]'); await pos.wait_for_timeout(800)
        o = call("GET", "/api/delivery/orders", None, kas); o = [x for x in o if x["id"] == oid][0]
        assert o["refund_amount"] > 0 and len(json.loads(o["changes"])) == 2, o
        await m.wait_for_timeout(5500); await m.screenshot(path=f"{OUT}/13-app-order-changed.png", full_page=True)
        # ---- POS: kechki chegirma oynasi
        await pos.click('[data-a="dDeals"]'); await pos.wait_for_selector('.modal select[name="product_id"]'); await pos.screenshot(path=f"{OUT}/04-deals.png")
        await pos.click('.modal [data-m="close"]')
        # ---- Platforma: dorixonalar
        pp = await (await b.new_context(viewport={"width": 1440, "height": 900})).new_page(); watch(pp, "platforma")
        await pp.goto(B + "/#platform"); await pp.fill("#p-pass", "pp-123456"); await pp.click('[data-p="platLogin"]')
        await pp.click('[data-p="platPharm"]'); await pp.wait_for_selector("h3:has-text('Dorixonalar')"); await pp.screenshot(path=f"{OUT}/20-platform-pharm.png")
        await b.close()
    print("ERRORS:", errors or "yo'q")
asyncio.run(main())
