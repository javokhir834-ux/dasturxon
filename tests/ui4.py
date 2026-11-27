import asyncio, json, urllib.request
from playwright.async_api import async_playwright
BASE = "http://localhost:8080"; OUT = __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "shots4"); __import__("os").makedirs(OUT, exist_ok=True); errors = []
async def pin(page, code):
    for d in code: await page.click(f'.pad button[data-k="{d}"]')
    await page.wait_for_selector("aside.side", timeout=5000)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=__import__("os").environ.get("CHROME","/usr/bin/google-chrome"), args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1400, "height": 880})
        pg = await ctx.new_page()
        pg.on("console", lambda m: m.type == "error" and "402" not in m.text and errors.append(m.text))
        pg.on("pageerror", lambda e: errors.append(str(e)))
        # Ro'yxatdan o'tish
        await pg.goto(BASE + "/#register"); await pg.wait_for_selector("#r-name")
        await pg.fill("#r-name", "Kafe Bahor"); await pg.fill("#r-owner", "Sardor"); await pg.fill("#r-phone", "901000001")
        await pg.fill("#r-pass", "parol123"); await pg.fill("#r-pin", "1234")
        await pg.screenshot(path=f"{OUT}/01-register.png")
        await pg.click('[data-p="doRegister"]'); await pg.wait_for_selector(".bigcode")
        code2 = await pg.inner_text(".bigcode")
        await pg.screenshot(path=f"{OUT}/02-registered.png")
        await pg.click('[data-p="toPos"]'); await pg.wait_for_selector(".pad")
        await pg.screenshot(path=f"{OUT}/03-pin-bizname.png")
        await pin(pg, "1234")
        await pg.click('nav.snav button[data-v="admin"]'); await pg.click('[data-v="settings"]'); await pg.wait_for_selector('#s-name')
        await pg.screenshot(path=f"{OUT}/04-settings-code.png")
        # Ega kabineti
        await pg.goto(BASE + "/#owner"); await pg.wait_for_selector("#o-phone")
        await pg.fill("#o-phone", "901000001"); await pg.fill("#o-pass", "parol123"); await pg.click('[data-p="ownerLogin"]')
        await pg.wait_for_selector('[data-p="newBranch"]')
        await pg.click('[data-p="newBranch"]')
        await pg.fill('.modal input[name="name"]', "Kafe Bahor — Chilonzor"); await pg.fill('.modal input[name="address"]', "Chilonzor 5-kvartal")
        await pg.fill('.modal input[name="admin_pin"]', "4321"); await pg.click('.modal [data-m="ok"]')
        await pg.wait_for_selector('.modal .bigcode'); await pg.click('.modal [data-m="close"]')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUT}/05-owner.png", full_page=True)
        # Platforma
        await pg.goto(BASE + "/#platform"); await pg.wait_for_selector("#p-pass")
        await pg.fill("#p-pass", "platforma-test-1"); await pg.click('[data-p="platLogin"]'); await pg.wait_for_selector('[data-p="extend"]')
        await pg.click('[data-p="extend"] >> nth=0'); await pg.fill('.modal input[name="months"]', "3"); await pg.click('.modal [data-m="ok"]')
        await pg.wait_for_timeout(400)
        # 1-biznesni muddati o'tgan qilamiz
        await pg.click('tr:has-text("Namuna restoran") [data-p="subEdit"]')
        await pg.fill('.modal input[name="pos_until"]', "2026-11-01"); await pg.click('.modal [data-m="ok"]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/06-platform.png", full_page=True)
        # Muddati o'tgan biznesda banner
        ctx2 = await b.new_context(viewport={"width": 1400, "height": 800}); p2 = await ctx2.new_page()
        p2.on("pageerror", lambda e: errors.append(str(e)))
        await p2.goto(BASE); await p2.wait_for_selector(".pad")
        biz1 = json.loads(urllib.request.urlopen(urllib.request.Request(BASE + "/api/platform/login", data=b'{"password":"platforma-test-1"}', headers={"Content-Type": "application/json"})).read())
        lst = json.loads(urllib.request.urlopen(urllib.request.Request(BASE + "/api/platform/businesses", headers={"Authorization": "Bearer " + biz1["token"]})).read())
        code1 = [x for x in lst if x["id"] == 1][0]["code"]
        for d in code1: await p2.click(f'.pad button[data-k="{d}"]')
        await p2.wait_for_timeout(500); await pin(p2, "2222")
        await p2.click('nav.snav button[data-v="cash"]'); await p2.wait_for_timeout(300)
        if await p2.query_selector('[data-a="openShift"]'): await p2.click('[data-a="openShift"]')
        await p2.wait_for_timeout(500)
        await p2.screenshot(path=f"{OUT}/07-expired-banner.png")
        await b.close()
    print("ERRORS:", errors or "yo'q")
asyncio.run(main())
