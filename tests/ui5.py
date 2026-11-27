import asyncio, json, urllib.request
from playwright.async_api import async_playwright
L="http://127.0.0.1:8080"; C="http://127.0.0.1:8090"; OUT=__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"shots5"); __import__("os").makedirs(OUT, exist_ok=True); errors=[]
def call(base, method, path, body=None, tok=None):
    h={"Content-Type":"application/json"}
    if tok: h["Authorization"]="Bearer "+tok
    r=urllib.request.Request(base+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    return json.loads(urllib.request.urlopen(r).read())
async def pin(page, code):
    for d in code: await page.click(f'.pad button[data-k="{d}"]')
    await page.wait_for_selector("aside.side", timeout=5000)
async def main():
    reg=call(C,"POST","/api/register",{"business_name":"Bahor (bulut)","owner_name":"Sardor","phone":"901000001","password":"parol123","admin_pin":"1234"})
    ow=call(C,"POST","/api/owner/login",{"phone":"901000001","password":"parol123"})["token"]
    key=call(C,"POST",f"/api/owner/branches/{reg['business_id']}/sync-key",{},ow)["key"]
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=__import__("os").environ.get("CHROME","/usr/bin/google-chrome"), args=["--no-sandbox"])
        ctx=await b.new_context(viewport={"width":1400,"height":900}); pg=await ctx.new_page()
        pg.on("console", lambda m: m.type=="error" and errors.append(m.text)); pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(L); await pin(pg,"1111")
        await pg.click('nav.snav button[data-v="admin"]'); await pg.click('[data-v="settings"]'); await pg.wait_for_selector('#sy-url')
        await pg.fill('#sy-url', C); await pg.fill('#sy-key', key); await pg.click('[data-a="syncOn"]')
        await pg.wait_for_timeout(3500); await pg.click('[data-a="syncRefresh"]'); await pg.wait_for_timeout(800)
        el=await pg.query_selector('h3:has-text("Bulut sinxronizatsiya")'); await el.scroll_into_view_if_needed()
        await pg.screenshot(path=f"{OUT}/01-local-sync-panel.png")
        # Bulut: PIN bilan kirish (nusxa)
        p2=await (await b.new_context(viewport={"width":1400,"height":800})).new_page(); p2.on("pageerror", lambda e: errors.append(str(e)))
        await p2.goto(C); await p2.wait_for_selector('.pad')
        for d in reg["code"]: await p2.click(f'.pad button[data-k="{d}"]')
        await p2.wait_for_timeout(600); await pin(p2,"1111")
        await p2.click('nav.snav button[data-v="reports"]'); await p2.wait_for_selector('.grid-stats'); await p2.wait_for_timeout(500)
        await p2.screenshot(path=f"{OUT}/02-cloud-mirror.png")
        await p2.goto(C+"/#owner"); await p2.wait_for_selector('#o-phone')
        await p2.fill('#o-phone','901000001'); await p2.fill('#o-pass','parol123'); await p2.click('[data-p="ownerLogin"]'); await p2.wait_for_selector('[data-p="syncKey"]')
        await p2.screenshot(path=f"{OUT}/03-owner-card.png")
        await b.close()
    print("ERRORS:", errors or "yo'q")
asyncio.run(main())
