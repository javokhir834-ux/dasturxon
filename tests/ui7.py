import asyncio, json, io, urllib.request
from PIL import Image
from playwright.async_api import async_playwright
B="http://127.0.0.1:8080"; OUT=__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"shots7"); __import__("os").makedirs(OUT, exist_ok=True); errors=[]
REST=(40.1033, 65.3735)
def call(method, path, body=None, tok=None):
    h={"Content-Type":"application/json"}
    if tok: h["Authorization"]="Bearer "+tok
    r=urllib.request.Request(B+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    return json.loads(urllib.request.urlopen(r).read())
def jpg(color):
    b=io.BytesIO(); Image.new("RGB",(1600,1000),color).save(b,"JPEG"); return {"name":"p.jpg","mimeType":"image/jpeg","buffer":b.getvalue()}
def watch(pg): pg.on("console", lambda m: m.type=="error" and errors.append(m.text)); pg.on("pageerror", lambda e: errors.append(str(e)))
async def photo(pg, sel, color=(90,140,200)):
    async with pg.expect_file_chooser() as fc: await pg.click(sel)
    await (await fc.value).set_files(files=[jpg(color)])
async def main():
    plat=call("POST","/api/platform/login",{"password":"pp-123456"})["token"]
    call("POST","/api/platform/settings",{"offer_seconds":60},plat)
    call("POST","/api/platform/businesses/1/subscription",{"product":"delivery","enabled":True,"paid_until":"2027-12-31"},plat)
    adm=call("POST","/api/login",{"pin":"1111"})["token"]; call("POST","/api/shift/open",{"opening_cash":0},adm)
    call("POST","/api/delivery/settings",{"enabled":True,"address":"Navoiy, Navoiy ko'chasi 12","delivery_fee":9000,"lat":REST[0],"lng":REST[1]},adm)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=__import__("os").environ.get("CHROME","/usr/bin/google-chrome"), args=["--no-sandbox"])
        kc=await b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await kc.grant_permissions(["geolocation"]); await kc.set_geolocation({"latitude":REST[0]+0.004,"longitude":REST[1]})
        k=await kc.new_page(); watch(k); k.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await k.goto(B+"/courier"); await k.fill('#ph','935551234'); await k.click('[data-a="otp"]'); await k.wait_for_selector('#dev:has-text("kod")')
        await k.fill('#code',(await k.text_content('#dev')).split('—')[-1].strip()); await k.click('[data-a="login"]')
        await k.wait_for_selector('#nm'); await k.fill('#nm','Bobur Karimov'); await k.click('[data-a="veh"][data-v="moto"]'); await k.fill('#vno','01a777aa')
        await k.screenshot(path=f"{OUT}/01-k-profile.png"); await k.click('[data-a="saveProfile"]')
        await k.wait_for_selector('[data-a="doc"][data-v="passport"]')
        await photo(k,'[data-a="doc"][data-v="passport"]'); await k.wait_for_selector('[data-a="doc"][data-v="passport"]:has-text("Qayta")')
        await photo(k,'[data-a="doc"][data-v="selfie"]',(200,150,120)); await k.wait_for_selector('[data-a="doc"][data-v="selfie"]:has-text("Qayta")')
        await photo(k,'[data-a="doc"][data-v="license"]',(120,200,150)); await k.wait_for_selector('[data-a="doc"][data-v="license"]:has-text("Qayta")')
        await k.screenshot(path=f"{OUT}/02-k-docs.png"); await k.click('[data-a="regStep"][data-v="3"]')
        await k.wait_for_selector('.q')
        for i,a in enumerate([1,1,1,0,1,1,1,0]): await k.click(f'[data-a="ans"][data-q="{i}"][data-v="{a}"]')
        await k.screenshot(path=f"{OUT}/03-k-test.png", full_page=True); await k.click('[data-a="sendTest"]')
        await k.wait_for_selector('[data-a="submit"]'); await k.click('[data-a="submit"]'); await k.wait_for_selector('h2:has-text("tekshirilmoqda")')
        await k.screenshot(path=f"{OUT}/04-k-pending.png")
        # Platforma: tasdiqlash
        pp=await (await b.new_context(viewport={"width":1440,"height":900})).new_page(); watch(pp)
        await pp.goto(B+"/#platform"); await pp.fill('#p-pass','pp-123456'); await pp.click('[data-p="platLogin"]')
        await pp.click('[data-p="platCouriers"]'); await pp.wait_for_selector('[data-p="courierOpen"]'); await pp.screenshot(path=f"{OUT}/10-p-couriers.png")
        await pp.click('[data-p="courierOpen"]'); await pp.wait_for_selector('.docs img')
        await pp.select_option('select[name="mtype"]','deposit'); await pp.fill('input[name="amount"]','200000')
        await pp.screenshot(path=f"{OUT}/11-p-courier-modal.png"); await pp.click('[data-act="approve"]'); await pp.wait_for_selector('.chip.info:has-text("Sinov")')
        await pp.screenshot(path=f"{OUT}/12-p-approved.png")
        # Kuryer: liniyaga
        await k.reload(); await k.wait_for_selector('[data-a="online"]'); await k.click('[data-a="online"]'); await k.wait_for_selector('[data-a="online"].on')
        await k.wait_for_timeout(11000)  # GPS yuborilishi
        await k.screenshot(path=f"{OUT}/05-k-online.png")
        # Mijoz buyurtmasi
        otp=call("POST","/api/c/otp",{"phone":"977001100"}); cl=call("POST","/api/c/login",{"phone":"977001100","code":otp["dev_code"],"name":"Javlon"})
        cu=cl["token"]; menu=call("GET","/api/c/places/"+call("GET","/api/bootstrap",None,adm)["business"]["code"])
        osh=[x for x in menu["products"] if x["name"].startswith("Osh")][0]
        r=call("POST","/api/c/orders",{"place":menu["place"]["code"],"items":[{"product_id":osh["id"],"qty":2}],"address":"Navoiy, Galaba 5-uy","provider":"test","lat":REST[0]+0.02,"lng":REST[1]},cu)
        oid=r["order"]["id"]; call("POST",f"/api/c/orders/{oid}/test-pay",None,cu)
        kas=call("POST","/api/login",{"pin":"2222"})["token"]; call("POST",f"/api/delivery/orders/{oid}/accept",{"prep_minutes":20},kas)
        await k.wait_for_selector('.offer', timeout=15000); await k.wait_for_timeout(1200); await k.screenshot(path=f"{OUT}/06-k-offer.png")
        await k.click('[data-a="accept"]'); await k.wait_for_selector('[data-v="arrived_rest"]'); await k.screenshot(path=f"{OUT}/07-k-assigned.png")
        # POS doskasi
        pos=await (await b.new_context(viewport={"width":1440,"height":900})).new_page(); watch(pos)
        await pos.goto(B);
        for d in "2222": await pos.click(f'.pad button[data-k="{d}"]')
        await pos.wait_for_selector('aside.side'); await pos.click('nav.snav button[data-v="delivery"]'); await pos.wait_for_selector('.cline'); await pos.screenshot(path=f"{OUT}/20-pos-courier.png")
        # Mijoz ekrani
        mc=await b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True)
        m=await mc.new_page(); watch(m)
        await m.goto(B+"/app"); await m.evaluate(f"localStorage.setItem('dx_ctoken','{cu}')"); await m.goto(B+f"/app/#order/{oid}"); await m.wait_for_selector('.hcode')
        await m.screenshot(path=f"{OUT}/30-c-order-code.png", full_page=True)
        await k.click('[data-v="arrived_rest"]'); await k.wait_for_selector('[data-a="pickup"]')
        ck=call("POST","/api/login",{"pin":"4444"})["token"]
        for it in call("GET","/api/kitchen",None,ck): call("POST",f"/api/items/{it['id']}/status",{"status":"ready"},ck)
        await k.wait_for_selector('[data-a="pickup"]:not([disabled])', timeout=8000); await k.screenshot(path=f"{OUT}/08-k-pickup.png")
        await photo(k,'[data-a="pickup"]',(160,120,80)); await k.wait_for_selector('[data-v="arrived"]'); await k.screenshot(path=f"{OUT}/09-k-onway.png")
        await k.click('[data-v="arrived"]'); await k.wait_for_selector('details'); await k.click('details summary'); await k.screenshot(path=f"{OUT}/13-k-at-customer.png", full_page=True)
        code=call("GET",f"/api/c/orders/{oid}",None,cu)["handover_code"]
        await k.fill('#kcode',code); await k.click('[data-a="deliver"]'); await k.wait_for_selector('[data-a="online"]'); await k.wait_for_timeout(800)
        await k.screenshot(path=f"{OUT}/14-k-done.png")
        await m.wait_for_selector('.stars', timeout=9000); await m.click('[data-a="star"][data-v="5"]'); await m.screenshot(path=f"{OUT}/31-c-rate.png", full_page=True)
        await m.click('[data-a="rate"]'); await m.wait_for_timeout(800)
        await k.click('[data-a="tab"][data-v="history"]'); await k.wait_for_selector('.line'); await k.screenshot(path=f"{OUT}/15-k-history.png", full_page=True)
        await b.close()
    print("ERRORS:", errors or "yo'q")
asyncio.run(main())
