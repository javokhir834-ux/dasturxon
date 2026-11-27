import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"; OUT = __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "shots2"); __import__("os").makedirs(OUT, exist_ok=True); errors = []

async def pin(page, code):
    for d in code: await page.click(f'button[data-k="{d}"]')
    await page.wait_for_selector("aside.side", timeout=5000)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=__import__("os").environ.get("CHROME","/usr/bin/google-chrome"), args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1366, "height": 860})
        pg = await ctx.new_page()
        pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(BASE); await pin(pg, "2222")
        # sotuv: smena, buyurtma, yuborish, bekor qilish (hisobdan chiqarish bilan), to'lov
        await pg.click('nav.snav button[data-v="cash"]'); await pg.fill("#open-cash", "100000"); await pg.click('[data-a="openShift"]'); await pg.wait_for_timeout(300)
        await pg.click('nav.snav button[data-v="floor"]'); await pg.click('.table >> nth=0'); await pg.click('.modal [data-v="2"]')
        await pg.wait_for_selector("#products .product")
        for i in [0, 0, 1]: await pg.click(f'#products .product >> nth={i}'); await pg.wait_for_timeout(120)
        await pg.click('[data-a="send"]'); await pg.wait_for_timeout(300)
        await pg.click('[data-a="cancelItem"] >> nth=1')
        await pg.fill('.modal input[name="reason"]', "Kuyib qoldi")
        await pg.screenshot(path=f"{OUT}/01-cancel-writeoff.png")
        await pg.click('.modal [data-m="ok"]'); await pg.wait_for_timeout(300)
        await pg.click('[data-a="pay"]'); await pg.click('.modal [data-q="all-naqd"]'); await pg.click('#pay-ok')
        await pg.wait_for_selector('.modal h2:has-text("qabul qilindi")'); await pg.click('.modal [data-m="close"]')
        await pg.click('[data-a="logout"]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"{OUT}/00-after-logout.png")
        try:
            await pin(pg, "1111")
        except Exception as e:
            await pg.screenshot(path=f"{OUT}/00-login-fail.png"); print("ERRS", errors); raise
        await pg.click('nav.snav button[data-v="stock"]'); await pg.wait_for_selector(".grid-stats")
        await pg.screenshot(path=f"{OUT}/02-stock.png", full_page=True)
        # Kirim
        await pg.click('[data-a="newInvoice"]'); await pg.wait_for_selector('#lm-rows')
        await pg.select_option('.modal select[name="supplier_id"]', index=1)
        await pg.fill('.modal input[name="number"]', "N-77")
        await pg.select_option('.modal select[name="ing_0"]', index=5)
        await pg.fill('.modal input[name="qty_0"]', "10")
        await pg.click('.modal [data-q="add"]')
        await pg.select_option('.modal select[name="ing_1"]', index=1)
        await pg.fill('.modal input[name="qty_1"]', "5"); await pg.fill('.modal input[name="price_1"]', "115000")
        await pg.fill('.modal input[name="paid_now"]', "300000")
        await pg.screenshot(path=f"{OUT}/03-invoice.png")
        await pg.click('.modal [data-m="ok"]'); await pg.wait_for_timeout(500)
        # Texkartalar
        await pg.click('[data-v="recipes"]'); await pg.wait_for_selector('#rec-editor h3')
        await pg.screenshot(path=f"{OUT}/04-recipes.png")
        await pg.click('[data-a="recAdd"]'); await pg.wait_for_timeout(100)
        await pg.select_option('#rec-editor select >> nth=-1', index=3)
        await pg.fill('#rec-editor input[type=number] >> nth=-1', "0.01"); await pg.press('#rec-editor input[type=number] >> nth=-1', 'Tab')
        await pg.click('[data-a="recSave"]'); await pg.wait_for_timeout(400)
        # Inventarizatsiya
        await pg.click('[data-v="inventory"]'); await pg.click('[data-a="invStart"]'); await pg.wait_for_selector('[data-inv]')
        await pg.fill('[data-inv] >> nth=0', "19"); await pg.fill('[data-inv] >> nth=4', "45")
        await pg.screenshot(path=f"{OUT}/05-inventory.png")
        await pg.click('[data-a="invSave"]'); await pg.click('.modal [data-m="ok"]'); await pg.wait_for_timeout(400)
        # Ta'minotchilar
        await pg.click('[data-v="suppliers"]'); await pg.wait_for_selector('table.list')
        await pg.screenshot(path=f"{OUT}/06-suppliers.png")
        await pg.click('[data-v="moves"]'); await pg.wait_for_selector('table.list')
        await pg.screenshot(path=f"{OUT}/07-moves.png")
        # Hisobotlar
        await pg.click('nav.snav button[data-v="reports"]'); await pg.wait_for_selector('.chart')
        await pg.hover('.chart-col >> nth=-1')
        await pg.screenshot(path=f"{OUT}/08-reports.png", full_page=True)
        await b.close()
    print("ERRORS:", errors or "yo'q")

asyncio.run(main())
