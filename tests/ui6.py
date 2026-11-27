import asyncio, json, io, urllib.request
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright
B="http://127.0.0.1:8080"; OUT=__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"shots6"); __import__("os").makedirs(OUT, exist_ok=True); errors=[]
def call(method, path, body=None, tok=None):
    h={"Content-Type":"application/json"}
    if tok: h["Authorization"]="Bearer "+tok
    r=urllib.request.Request(B+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    return json.loads(urllib.request.urlopen(r).read())
def png():
    im=Image.new("RGB",(1200,900),(196,120,48)); d=ImageDraw.Draw(im)
    d.ellipse((250,150,950,750),fill=(240,200,120)); d.ellipse((420,300,780,600),fill=(150,80,30))
    b=io.BytesIO(); im.save(b,"PNG"); return b.getvalue()
async def pin(page, code):
    for d in code: await page.click(f'.pad button[data-k="{d}"]')
    await page.wait_for_selector("header.top", timeout=5000)
def watch(pg): pg.on("console", lambda m: m.type=="error" and errors.append(m.text)); pg.on("pageerror", lambda e: errors.append(str(e)))
async def main():
    plat=call("POST","/api/platform/login",{"password":"pp-123456"})["token"]
    call("POST","/api/platform/businesses/1/subscription",{"product":"delivery","enabled":True,"paid_until":"2027-12-31"},plat)
    adm=call("POST","/api/login",{"pin":"1111"})["token"]; call("POST","/api/shift/open",{"opening_cash":0},adm)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=__import__("os").environ.get("CHROME","/usr/bin/google-chrome"), args=["--no-sandbox","--autoplay-policy=no-user-gesture-required"])
        pos=await (await b.new_context(viewport={"width":1440,"height":900})).new_page(); watch(pos)
        await pos.goto(B); await pin(pos,"1111")
        # Boshqaruv → Yetkazib berish sozlamalari
        await pos.click('nav.tabs button[data-v="admin"]'); await pos.click('[data-a="atab"][data-v="delivery"]'); await pos.wait_for_selector('#d-enabled')
        await pos.check('#d-enabled'); await pos.fill('#d-address','Navoiy sh., Navoiy ko\'chasi 12'); await pos.fill('#d-description','Milliy taomlar: osh, somsa, sho\'rva')
        await pos.select_option('#d-delivery_by','own'); await pos.fill('#d-delivery_fee','8000'); await pos.fill('#d-min_order','30000'); await pos.click('[data-a="saveDlv"]'); await pos.wait_for_timeout(700)
        await pos.screenshot(path=f"{OUT}/01-pos-delivery-settings.png", full_page=True)
        assert await pos.query_selector('nav.tabs button[data-v="delivery"]'), "Yetkazish bo'limi menyuda yo'q"
        # Menyu: rasm qo'shish
        await pos.click('[data-a="atab"][data-v="products"]'); await pos.wait_for_selector('table.list')
        await pos.click('table.list tr:nth-child(2) [data-a="aedit"]'); await pos.wait_for_selector('.imgpick')
        await pos.set_input_files('.imgpick input[type=file]', files=[{"name":"osh.png","mimeType":"image/png","buffer":png()}])
        await pos.wait_for_selector('.imgpick img:not([hidden])'); await pos.screenshot(path=f"{OUT}/02-product-image.png")
        await pos.click('.modal [data-m="ok"]'); await pos.wait_for_timeout(700)
        await pos.screenshot(path=f"{OUT}/03-menu-list.png")
        # Mijoz ilovasi (telefon)
        mc=await b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await mc.grant_permissions(["geolocation"]); await mc.set_geolocation({"latitude":40.1033,"longitude":65.3735})
        m=await mc.new_page(); watch(m); m.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await m.goto(B+"/app"); await m.wait_for_selector('.prow'); await m.screenshot(path=f"{OUT}/10-app-places.png")
        await m.click('.prow'); await m.wait_for_selector('.mi')
        await m.click('.mi >> nth=0 >> [data-a="qty"]'); await m.click('.mi >> nth=0 >> [data-d="1"]'); await m.click('.mi >> nth=1 >> [data-a="qty"]')
        await m.wait_for_selector('.bottombar .btn'); await m.screenshot(path=f"{OUT}/11-app-menu.png")
        await m.click('.bottombar .btn'); await m.wait_for_selector('#qbox .label')
        await m.fill('#addr','Navoiy, Galaba 5-uy, 12-xonadon'); await m.click('[data-a="geo"]'); await m.wait_for_timeout(500)
        await m.click('#place'); await m.wait_for_selector('#ph')
        await m.fill('#ph','901234567'); await m.click('[data-a="otp"]'); await m.wait_for_selector('#dev:has-text("kod")')
        code=(await m.text_content('#dev')).split('—')[-1].strip()
        await m.screenshot(path=f"{OUT}/12-app-login.png")
        await m.fill('#code',code); await m.fill('#nm','Javlon'); await m.click('[data-a="login"]')
        await m.wait_for_selector('#qbox .label'); await m.wait_for_timeout(300); await m.screenshot(path=f"{OUT}/13-app-cart.png", full_page=True)
        await m.click('#place'); await m.wait_for_selector('[data-a="testpay"]'); await m.screenshot(path=f"{OUT}/14-app-pay.png")
        await m.click('[data-a="testpay"]'); await m.wait_for_selector('.prog'); await m.screenshot(path=f"{OUT}/15-app-order-new.png")
        # POS: yangi buyurtma kassada
        await pos.wait_for_selector('nav.tabs .nbadge', timeout=6000)
        await pos.click('nav.tabs button[data-v="delivery"]'); await pos.wait_for_selector('.dcard.new'); await pos.screenshot(path=f"{OUT}/20-pos-board-new.png")
        await pos.click('.dcard.new [data-a="dAccept"]'); await pos.click('.modal [data-v="20"]'); await pos.wait_for_selector('.dcard.accepted')
        await pos.screenshot(path=f"{OUT}/21-pos-board-accepted.png")
        await pos.click('nav.tabs button[data-v="kitchen"]'); await pos.wait_for_timeout(600); await pos.screenshot(path=f"{OUT}/22-kitchen-delivery.png")
        ck=call("POST","/api/login",{"pin":"4444"})["token"]
        for it in call("GET","/api/kitchen",None,ck): call("POST",f"/api/items/{it['id']}/status",{"status":"ready"},ck)
        await pos.click('nav.tabs button[data-v="delivery"]'); await pos.wait_for_selector('.dcard.ready', timeout=6000)
        await pos.click('.dcard.ready [data-a="dDispatch"]'); await pos.wait_for_selector('.dcard.on_way')
        await m.wait_for_timeout(5500); await m.screenshot(path=f"{OUT}/16-app-order-onway.png", full_page=True)
        await pos.click('.dcard.on_way [data-a="dDelivered"]'); await pos.wait_for_selector('table.list:has-text("Yetkazildi")')
        await pos.screenshot(path=f"{OUT}/23-pos-board-done.png", full_page=True)
        await pos.click('nav.tabs button[data-v="cash"]'); await pos.wait_for_selector('.grid-stats'); await pos.screenshot(path=f"{OUT}/24-cash-onlayn.png")
        await m.wait_for_timeout(5500); await m.screenshot(path=f"{OUT}/17-app-delivered.png")
        await m.click('[data-a="back"]'); await m.wait_for_selector('#olist .li'); await m.screenshot(path=f"{OUT}/18-app-orders.png")
        await b.close()
    print("ERRORS:", errors or "yo'q")
asyncio.run(main())
